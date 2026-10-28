const mongoose = require("mongoose");
const crypto = require("node:crypto");
const ChildProfile = require("../models/childProfile");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const SponsorVerificationRequest = require("../models/sponsorVerificationRequest");
const AchSettings = require("../models/achSettings");
const Admin = require("../models/admin");
const Notification = require("../models/notification");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const {
  sendSponsorPaymentContinuationEmail,
  sendSponsorVerificationEmail,
} = require("../utils/mail");
const { deliverAchInstructions } = require("../utils/achInstructionDelivery");
const { createPaymentPageToken } = require("../utils/stripePaymentPage");
const { getConfiguredPaymentLink } = require("./stripePaymentLinkSettingsController");
const { isValidCloudinaryImageReference } = require("../utils/cloudinaryImageReference");
const { createNotificationForUsers } = require("../utils/notificationUtil");
const {
  CURRENT_SPONSORSHIP_STATUSES,
  MAX_RESENDS,
  RESEND_COOLDOWN_MS,
  createVerificationToken,
  currentPairKey,
  hashVerificationToken,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  requestPurgeDate,
  verificationExpiry,
} = require("../utils/sponsorVerification");

const SUPPORTED_PERIODS = ["Monthly", "3 Months", "6 Months", "Yearly"];
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;

function normalizeProfile(body = {}) {
  const source = body.profile || body.sponsor || {};
  const location = body.location || {};
  return {
    fullName: String(source.fullName || source.name || body.name || "").trim(),
    email: normalizeEmail(source.email || body.email),
    phone: String(source.phone || body.phone || "").trim(),
    country: String(source.country || location.country || "").trim(),
    city: String(source.city || location.city || "").trim(),
    state: String(source.state || location.state || "").trim(),
    region: String(source.region || location.region || "").trim(),
    zipCode: String(source.zipCode || location.zipCode || "").trim(),
    bio: String(source.bio || "").trim(),
  };
}

function normalizeLocation(body = {}, profile = {}) {
  const location = body.location || {};
  return {
    address: String(location.address || "").trim(),
    country: String(location.country || profile.country || "").trim(),
    city: String(location.city || profile.city || "").trim(),
    state: String(location.state || profile.state || "").trim(),
    region: String(location.region || profile.region || "").trim(),
    zipCode: String(location.zipCode || profile.zipCode || "").trim(),
  };
}

function getProfileStatus(profile) {
  return ["fullName", "email", "phone", "country", "city", "state", "region", "zipCode"]
    .every((field) => String(profile[field] || "").trim())
    ? "Complete"
    : "Incomplete";
}

function setHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function serializeRequest(request) {
  return {
    _id: request._id,
    requestId: request.requestId,
    status: request.status,
    profile: request.profile,
    location: request.location,
    child: request.child,
    paymentMethod: request.paymentMethod,
    donation: request.donation,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    resendCount: request.resendCount,
    identityReviewReason: request.identityReviewReason,
    adminFollowUp: request.adminFollowUp,
  };
}

function getEmailMatch(email) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedEmail}$`, "i");
}

async function deliverVerificationEmail(request, rawToken) {
  try {
    await sendSponsorVerificationEmail({
      email: request.profile.email,
      name: request.profile.fullName,
      token: rawToken,
      requestId: request.requestId,
    });
    request.emailDeliveryStatus = "sent";
    await request.save();
  } catch (error) {
    request.emailDeliveryStatus = "failed";
    await request.save();
    throw error;
  }
}

async function queueRequest(body) {
  const profile = normalizeProfile(body);
  const childId = String(body.childId || body.child || "");
  const requestId = String(body.requestId || crypto.randomUUID());
  const paymentMethod = String(body.paymentMethod || "").toLowerCase();
  const amount = Number(body.donation?.amount);
  const period = String(body.donation?.period || "");

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw setHttpError(400, "A valid request identifier is required.");
  }
  if (!mongoose.isValidObjectId(childId)) {
    throw setHttpError(400, "A valid child is required.");
  }
  if (
    profile.fullName.length < 2 ||
    !isValidEmail(profile.email) ||
    !profile.phone ||
    !Number.isFinite(amount) ||
    amount < 5 ||
    amount > 100000 ||
    !SUPPORTED_PERIODS.includes(period) ||
    !["ach", "stripe"].includes(paymentMethod)
  ) {
    throw setHttpError(400, "Please provide valid sponsor, child, and pledge details.");
  }
  if (body.image && !isValidCloudinaryImageReference(body.image)) {
    throw setHttpError(400, "Sponsor image is invalid.");
  }

  const child = await ChildProfile.findById(childId).select("_id");
  if (!child) {
    throw setHttpError(409, "This child is no longer available.");
  }
  if (paymentMethod === "ach" && !(await AchSettings.exists({ _id: "organization-ach" }))) {
    throw setHttpError(503, "Manual bank transfer instructions are not configured yet.");
  }
  if (paymentMethod === "stripe") {
    const stripeLink = await getConfiguredPaymentLink();
    if (!stripeLink.configured) {
      throw setHttpError(503, "Stripe donations are not configured yet.");
    }
  }

  const existing = await SponsorVerificationRequest.findOne({ requestId }).select("+tokenHash");
  if (existing) {
    if (existing.profile.email !== profile.email || String(existing.child) !== childId) {
      throw setHttpError(409, "This request identifier has already been used.");
    }
    if (existing.status === "pending" && existing.expiresAt > new Date()) {
      if (existing.emailDeliveryStatus === "failed") {
        await resendVerificationEmail(existing);
      }
      return { request: existing, duplicateRequest: true };
    }
    if (["verified", "duplicate"].includes(existing.status)) {
      throw setHttpError(409, "This pledge request has already been completed.");
    }
    throw setHttpError(409, "This request has expired or needs staff review. Please submit again.");
  }

  const { token, tokenHash } = createVerificationToken();
  const now = new Date();
  const request = await SponsorVerificationRequest.create({
    requestId,
    tokenHash,
    status: "pending",
    profile,
    location: normalizeLocation(body, profile),
    image: body.image
      ? { url: String(body.image.url), public_id: String(body.image.public_id) }
      : undefined,
    donation: {
      amount,
      period,
      remindByEmail: body.donation?.remindByEmail !== false,
    },
    child: child._id,
    paymentMethod,
    expiresAt: verificationExpiry(now),
    purgeAt: requestPurgeDate(now),
    lastSentAt: now,
  });

  try {
    await deliverVerificationEmail(request, token);
  } catch (error) {
    console.error("Sponsor verification email delivery failed:", error.message);
    throw setHttpError(
      503,
      "Your request is saved, but we could not send the verification email. Please ask the organization to resend it.",
    );
  }

  return { request, duplicateRequest: false };
}

async function createSponsorVerificationRequest(req, res) {
  try {
    const { request, duplicateRequest } = await queueRequest(req.body || {});
    return res.status(duplicateRequest ? 200 : 201).json({
      message: "Check your email for a link to verify your address and continue.",
      requestId: request.requestId,
      email: request.profile.email,
      expiresAt: request.expiresAt,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode
        ? error.message
        : "Unable to start email verification.",
    });
  }
}

async function resendVerificationEmail(request, { adminInitiated = false } = {}) {
  const now = new Date();
  if (!adminInitiated && request.resendCount >= MAX_RESENDS) {
    throw setHttpError(429, "The resend limit has been reached. Please contact the organization.");
  }
  if (now.getTime() - new Date(request.lastSentAt || 0).getTime() < RESEND_COOLDOWN_MS) {
    throw setHttpError(429, "Please wait before requesting another verification email.");
  }

  const { token, tokenHash } = createVerificationToken();
  request.tokenHash = tokenHash;
  request.status = "pending";
  request.expiresAt = verificationExpiry(now);
  request.purgeAt = requestPurgeDate(now);
  request.lastSentAt = now;
  request.emailDeliveryStatus = "pending";
  request.resendCount += 1;
  await request.save();
  await deliverVerificationEmail(request, token);
}

async function resendPublicVerificationEmail(req, res) {
  const requestId = String(req.body?.requestId || "");
  const email = normalizeEmail(req.body?.email);
  try {
    const request = await SponsorVerificationRequest.findOne({
      requestId,
      "profile.email": email,
      status: { $in: ["pending", "expired"] },
    }).select("+tokenHash");
    if (request) await resendVerificationEmail(request);
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({ message: error.message });
    }
    console.error("Public sponsor verification resend failed:", error.message);
  }
  return res.status(200).json({
    message: "If the request can be resent, a new verification email will arrive shortly.",
  });
}

async function createVerifiedSponsorship(request, sponsor, session) {
  const existingPair = await Sponsorships.findOne({
    child: request.child,
    donor: sponsor._id,
    status: { $in: CURRENT_SPONSORSHIP_STATUSES },
  }).session(session);
  if (existingPair) {
    request.status = "duplicate";
    request.sponsor = sponsor._id;
    request.sponsorship = existingPair._id;
    request.verifiedAt = request.verifiedAt || new Date();
    request.tokenHash = undefined;
    await request.save({ session });
    return { duplicate: true, sponsorship: existingPair };
  }

  const child = await ChildProfile.findById(request.child).session(session);
  if (!child) throw setHttpError(409, "This child profile is no longer available.");

  const pledgeReference = `${request.paymentMethod === "ach" ? "ACH" : "STRIPE"}-${new mongoose.Types.ObjectId().toString().toUpperCase()}`;
  const sponsorship = new Sponsorships({
    child: child._id,
    donor: sponsor._id,
    activePairKey: currentPairKey(child._id, sponsor._id),
    paymentMethod: request.paymentMethod,
    publicPledgeReference: pledgeReference,
    publicRequestId: request.requestId,
    startDate: new Date(),
    amount: request.donation.amount,
    currency: "USD",
    frequency: request.donation.period,
    status: "Pending",
    payments: [],
    ...(request.paymentMethod === "ach"
      ? { achInstructionEmail: { status: "pending", attempts: 0 } }
      : {}),
    totalPaid: 0,
    notes: `Public ${request.paymentMethod.toUpperCase()} pledge; awaiting payment verification.`,
  });
  await sponsorship.save({ session });

  request.status = "verified";
  request.verifiedAt = new Date();
  request.sponsor = sponsor._id;
  request.sponsorship = sponsorship._id;
  await request.save({ session });
  return { duplicate: false, sponsorship };
}

async function verifySponsorEmail(req, res) {
  const rawToken = String(req.body?.token || "");
  if (rawToken.length < 40 || rawToken.length > 100) {
    return res.status(400).json({ message: "The verification link is invalid or expired." });
  }
  const tokenHash = hashVerificationToken(rawToken);
  const session = await mongoose.startSession();
  let outcome;

  try {
    await session.withTransaction(async () => {
      const request = await SponsorVerificationRequest.findOne({
        tokenHash,
        status: { $in: ["pending", "verified"] },
        expiresAt: { $gt: new Date() },
      }).select("+tokenHash").session(session);
      if (!request) {
        throw setHttpError(410, "This verification link is invalid, already used, or expired.");
      }
      if (request.status === "verified") {
        outcome = {
          status: "verified",
          existing: true,
          requestId: request.requestId,
          sponsorshipId: request.sponsorship,
          paymentMethod: request.paymentMethod,
          continuationPath: request.continuationPath,
        };
        return;
      }

      const verifiedCandidates = await Sponsor.find({
        "profile.email": getEmailMatch(request.profile.email),
        emailVerified: true,
      }).session(session);
      const candidates = verifiedCandidates.length
        ? verifiedCandidates
        : await Sponsor.find({
            "profile.email": getEmailMatch(request.profile.email),
          }).session(session);
      if (candidates.length === 1 && candidates[0].isArchived) {
        request.status = "identity_review";
        request.verifiedAt = new Date();
        request.identityReviewReason = "The verified email matches an archived sponsor profile.";
        request.tokenHash = undefined;
        await request.save({ session });
        outcome = { status: "identity_review", requestId: request.requestId };
        return;
      }
      if (candidates.length > 1) {
        request.status = "identity_review";
        request.verifiedAt = new Date();
        request.identityReviewReason = "Multiple sponsor profiles match this verified email.";
        request.tokenHash = undefined;
        await request.save({ session });
        outcome = { status: "identity_review", requestId: request.requestId };
        return;
      }

      let sponsor = candidates[0];
      if (sponsor) {
        const existingPhone = normalizePhone(sponsor.profile?.phone);
        const submittedPhone = normalizePhone(request.profile.phone);
        if (existingPhone && submittedPhone && existingPhone !== submittedPhone) {
          request.status = "identity_review";
          request.verifiedAt = new Date();
          request.identityReviewReason = "The verified email matches a sponsor profile with a different phone number.";
          request.tokenHash = undefined;
          await request.save({ session });
          outcome = { status: "identity_review", requestId: request.requestId };
          return;
        }
        sponsor.profile.email = request.profile.email;
        sponsor.emailVerified = true;
        sponsor.emailVerifiedAt = new Date();
        await sponsor.save({ session });
      } else {
        sponsor = new Sponsor({
          profile: request.profile,
          sponsor: {
            name: request.profile.fullName,
            email: request.profile.email,
            phone: request.profile.phone,
          },
          image: request.image,
          location: request.location,
          donation: request.donation,
          paymentMethod: request.paymentMethod,
          profileStatus: getProfileStatus(request.profile),
          emailVerified: true,
          emailVerifiedAt: new Date(),
          source: "website",
        });
        await sponsor.save({ session });
      }

      outcome = {
        status: "verified",
        sponsorId: sponsor._id,
        requestId: request.requestId,
        ...(await createVerifiedSponsorship(request, sponsor, session)),
        paymentMethod: request.paymentMethod,
      };
    });

    if (outcome.status === "identity_review") {
      try {
        await notifyAdminsOfIdentityReview(outcome.requestId);
      } catch (notificationError) {
        console.error(
          "Unable to notify admins about sponsor identity review:",
          notificationError.message,
        );
      }
      return res.status(202).json({
        status: "identity_review",
        message: "Your email is verified. Staff need to review an existing sponsor record before this pledge can continue.",
      });
    }
    if (outcome.duplicate) {
      return res.status(409).json({
        status: "duplicate",
        message: "You already have a pending or active sponsorship for this child. No second relationship was created.",
        existingSponsorship: {
          status: outcome.sponsorship.status,
          reference: outcome.sponsorship.publicPledgeReference || "",
        },
      });
    }

    const request = await SponsorVerificationRequest.findOne({
      requestId: outcome.requestId,
    });
    const sponsorship = await Sponsorships.findById(
      outcome.existing ? outcome.sponsorshipId : outcome.sponsorship._id,
    );
    const result = {
      status: "verified",
      message: "Your email is verified and your pledge is ready.",
      paymentMethod: outcome.paymentMethod,
      pledge: {
        reference: sponsorship.publicPledgeReference,
        amount: sponsorship.amount,
        currency: sponsorship.currency,
        period: sponsorship.frequency,
        status: sponsorship.status,
      },
    };
    if (outcome.paymentMethod === "ach") {
      result.emailDelivery = await deliverAchInstructions(sponsorship._id);
    } else {
      if (outcome.continuationPath || request?.continuationPath) {
        result.paymentPagePath = outcome.continuationPath || request.continuationPath;
      } else {
        const paymentToken = await createPaymentPageToken({
          sponsorshipId: sponsorship._id,
          dueDate: sponsorship.startDate || new Date(),
          dueDateKey: "initial",
          expectedAmount: sponsorship.amount,
        });
        result.paymentPagePath = paymentToken.path;
        if (request) {
          request.continuationPath = paymentToken.path;
          await request.save();
        }
      }
    }
    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This request was processed concurrently. Please use the same verification link again.",
      });
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode
        ? error.message
        : "Unable to verify this email. Please request a new link.",
    });
  } finally {
    await session.endSession();
  }
}

async function notifyAdminsOfIdentityReview(requestId) {
  const request = await SponsorVerificationRequest.findOne({ requestId });
  const admins = await Admin.find({ isActive: true }).select("_id").lean();
  if (!request || !admins.length) return;
  await createNotificationForUsers({
    userIds: admins.map((admin) => admin._id),
    type: "sponsor_email_verification",
    title: "Sponsor identity needs review",
    description: `A verified sponsorship request for ${request.profile.fullName} needs identity review.`,
    linkTo: "/dashboard/sponsorships",
    relatedEntityType: "sponsor_verification_request",
    relatedEntityId: String(request._id),
  });
}

async function getPendingSponsorVerificationRequests(req, res) {
  try {
    const pagination = getPagination(req);
    const filter = {
      status: { $in: ["pending", "identity_review", "expired"] },
    };
    const [requests, total] = await Promise.all([
      SponsorVerificationRequest.find(filter)
        .select("-tokenHash")
        .populate("child", "firstName secondName givenName")
        .populate("sponsor", "profile.fullName profile.email profile.phone")
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      SponsorVerificationRequest.countDocuments(filter),
    ]);
    const identityReviews = requests.filter((request) => request.status === "identity_review");
    const candidates = await Promise.all(
      identityReviews.map(async (request) => {
        const matches = await Sponsor.find({
          "profile.email": getEmailMatch(request.profile.email),
        })
          .select("_id profile.fullName profile.email profile.phone isArchived")
          .lean();
        return [String(request._id), matches.map((sponsor) => ({
          _id: sponsor._id,
          profile: sponsor.profile,
          isArchived: sponsor.isArchived,
        }))];
      }),
    );
    const candidatesByRequestId = new Map(candidates);
    const requestsWithCandidates = requests.map((request) => ({
      ...request,
      identityCandidates: candidatesByRequestId.get(String(request._id)) || [],
    }));
    setPaginationHeaders(res, { ...pagination, total });
    return res.status(200).json(requestsWithCandidates);
  } catch (error) {
    console.error("Unable to load sponsor verification queue:", error.message);
    return res.status(500).json({ message: "Unable to load sponsor verification requests." });
  }
}

async function resendSponsorVerificationRequest(req, res) {
  try {
    const request = await SponsorVerificationRequest.findById(req.params.id).select("+tokenHash");
    if (!request || !["pending", "expired"].includes(request.status)) {
      return res.status(404).json({ message: "A resendable verification request was not found." });
    }
    await resendVerificationEmail(request, { adminInitiated: true });
    return res.status(200).json({ message: "Verification email resent." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to resend verification email.",
    });
  }
}

async function recordSponsorVerificationFollowUp(req, res) {
  const note = String(req.body?.note || "").trim();
  if (!note || note.length > 1000) {
    return res.status(400).json({ message: "A follow-up note of at most 1,000 characters is required." });
  }
  try {
    const adminId = req.admin?.id || req.admin?._id;
    if (!adminId) {
      return res.status(401).json({ message: "An authenticated admin is required." });
    }
    const request = await SponsorVerificationRequest.findByIdAndUpdate(
      req.params.id,
      {
        $set: { adminFollowUp: note },
        $push: { followUpHistory: { note, admin: adminId } },
      },
      { new: true, runValidators: true },
    );
    if (!request) return res.status(404).json({ message: "Verification request not found." });
    return res.status(200).json({ message: "Follow-up note recorded." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to record follow-up." });
  }
}

async function resolveSponsorIdentityReview(req, res) {
  const { sponsorId, action } = req.body || {};
  const adminId = req.admin?.id || req.admin?._id;
  if (!["link_existing", "reject"].includes(action)) {
    return res.status(400).json({ message: "Choose an identity or reject the request." });
  }
  if (!adminId) {
    return res.status(401).json({ message: "An authenticated admin is required." });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const request = await SponsorVerificationRequest.findOne({
        _id: req.params.id,
        status: "identity_review",
        verifiedAt: { $ne: null },
      }).session(session);
      if (!request) throw setHttpError(404, "Verified identity review request not found.");
      if (action === "reject") {
        request.status = "duplicate";
        request.identityReviewReason = "Rejected by staff after identity review.";
        request.tokenHash = undefined;
        request.followUpHistory.push({
          note: "Closed request after identity review.",
          admin: adminId,
        });
        await request.save({ session });
        result = { status: "rejected" };
        return;
      }
      if (!mongoose.isValidObjectId(sponsorId)) {
        throw setHttpError(400, "A valid sponsor identity is required.");
      }
      const sponsor = await Sponsor.findOne({
        _id: sponsorId,
        "profile.email": getEmailMatch(request.profile.email),
      }).session(session);
      if (!sponsor) throw setHttpError(404, "Selected sponsor does not match the verified email.");
      if (sponsor.isArchived) {
        throw setHttpError(409, "Archived sponsor profiles cannot be linked.");
      }
      sponsor.emailVerified = true;
      sponsor.emailVerifiedAt = sponsor.emailVerifiedAt || request.verifiedAt;
      await sponsor.save({ session });
      result = await createVerifiedSponsorship(request, sponsor, session);
      request.followUpHistory.push({
        note: `Linked request to sponsor identity ${sponsor._id} after manual review.`,
        admin: adminId,
      });
      await request.save({ session });
      if (result.duplicate) {
        result.status = "duplicate";
        return;
      }
      result.status = "verified";
      result.paymentMethod = request.paymentMethod;
    });
    if (result.status === "verified") {
      const request = await SponsorVerificationRequest.findById(req.params.id);
      const sponsorship = await Sponsorships.findById(request.sponsorship);
      if (request.paymentMethod === "ach") {
        result.emailDelivery = await deliverAchInstructions(sponsorship._id);
      } else {
        const paymentToken = await createPaymentPageToken({
          sponsorshipId: sponsorship._id,
          dueDate: sponsorship.startDate || new Date(),
          dueDateKey: "initial",
          expectedAmount: sponsorship.amount,
        });
        const paymentUrl = new URL(
          paymentToken.path,
          process.env.WEBSITE_URL || "https://www.seedsoflovefoundation.org",
        ).toString();
        await sendSponsorPaymentContinuationEmail({
          email: request.profile.email,
          name: request.profile.fullName,
          paymentUrl,
        });
      }
    }
    return res.status(200).json({
      status: result.status,
      message: result.status === "rejected"
        ? "The request was closed after review."
        : result.status === "duplicate"
          ? "The sponsor already has a current relationship with this child."
          : "The verified request was linked to the selected sponsor.",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to resolve sponsor identity review.",
    });
  } finally {
    await session.endSession();
  }
}

async function processSponsorVerificationDigests({ now = new Date() } = {}) {
  const deadline = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const requests = await SponsorVerificationRequest.find({
    status: "pending",
    expiresAt: { $gt: now, $lte: deadline },
    $or: [{ lastAdminDigestAt: null }, { lastAdminDigestAt: { $lt: new Date(now.getTime() - 20 * 60 * 60 * 1000) } }],
  }).select("_id");
  if (!requests.length) return 0;
  const admins = await Admin.find({ isActive: true }).select("_id").lean();
  if (!admins.length) return 0;
  const dayKey = now.toISOString().slice(0, 10);
  await Promise.all(
    admins.map(async (admin) => {
      const alreadyNotified = await Notification.exists({
        userId: admin._id,
        type: "sponsor_email_verification",
        relatedEntityType: "sponsor_verification_digest",
        relatedEntityId: dayKey,
      });
      if (alreadyNotified) return;
      await createNotificationForUsers({
        userIds: [admin._id],
        type: "sponsor_email_verification",
        title: "Email verification requests nearing expiry",
        description: `${requests.length} sponsor verification request(s) expire within six hours.`,
        linkTo: "/dashboard/sponsorships",
        relatedEntityType: "sponsor_verification_digest",
        relatedEntityId: dayKey,
      });
    }),
  );
  await SponsorVerificationRequest.updateMany(
    { _id: { $in: requests.map((request) => request._id) } },
    { $set: { lastAdminDigestAt: now } },
  );
  return requests.length;
}

async function expireSponsorVerificationRequests({ now = new Date() } = {}) {
  const result = await SponsorVerificationRequest.updateMany(
    { status: "pending", expiresAt: { $lte: now } },
    { $set: { status: "expired" }, $unset: { tokenHash: "" } },
  );
  const verifiedTokens = await SponsorVerificationRequest.updateMany(
    { status: "verified", expiresAt: { $lte: now }, tokenHash: { $exists: true } },
    { $unset: { tokenHash: "" } },
  );
  return (result.modifiedCount || 0) + (verifiedTokens.modifiedCount || 0);
}

module.exports = {
  createSponsorVerificationRequest,
  expireSponsorVerificationRequests,
  getPendingSponsorVerificationRequests,
  processSponsorVerificationDigests,
  recordSponsorVerificationFollowUp,
  resendPublicVerificationEmail,
  resendSponsorVerificationRequest,
  resolveSponsorIdentityReview,
  verifySponsorEmail,
};
