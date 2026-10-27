const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Admin = require("../models/admin");
const ChildProfile = require("../models/childProfile");
const Notification = require("../models/notification");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const StripePaymentAttempt = require("../models/stripePaymentAttempt");
const StripePaymentLinkSettings = require("../models/stripePaymentLinkSettings");
const { sendEmail } = require("../utils/mail");
const {
  getAttemptCheckoutUrl,
  getExpectedAmountForPage,
  getValidPaymentPageToken,
} = require("../utils/stripePaymentPage");
const { isStripeOverpayment } = require("../utils/stripePaymentAttempt");
const { getConfiguredPaymentLink } = require("./stripePaymentLinkSettingsController");

const ATTEMPT_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_ALERT_EMAIL = "info@ensigooflove.org";

function getChildName(child) {
  return [child?.givenName || child?.firstName, child?.secondName]
    .filter(Boolean)
    .join(" ") || "your sponsored child";
}

async function getPageSummary(tokenRecord) {
  const sponsorship = tokenRecord.sponsorship;
  const amountDue = await getExpectedAmountForPage(tokenRecord);
  return {
    amount: amountDue,
    currency: sponsorship.currency || "USD",
    cadence: sponsorship.frequency || "Monthly",
    childName: getChildName(sponsorship.child),
    dueDate: tokenRecord.dueDate,
    pledgeReference: sponsorship.publicPledgeReference || String(sponsorship._id),
  };
}

async function notifyPaymentAttempt(attempt, sponsorship, sponsor) {
  let inAppNotifiedAt = null;
  let inAppNotificationError = "";
  let adminEmailSentAt = null;
  let adminEmailError = "";
  const admins = await Admin.find({ isActive: true }).select("_id");
  const title = "Stripe payment attempt needs verification";
  const description =
    `${sponsor.profile?.fullName || sponsor.sponsor?.name || "A sponsor"} started a Stripe payment attempt of ` +
    `${sponsorship.currency || "USD"} ${attempt.expectedAmount.toFixed(2)} for ` +
    `${attempt.publicReference}. Verify it in Stripe Dashboard before recording a payment.`;
  try {
    const existing = admins.length
      ? await Notification.find({
          userId: { $in: admins.map((admin) => admin._id) },
          relatedEntityType: "stripe_payment_attempt",
          relatedEntityId: String(attempt._id),
        }).select("userId")
      : [];
    const alreadyNotified = new Set(existing.map((item) => String(item.userId)));
    const missing = admins.filter((admin) => !alreadyNotified.has(String(admin._id)));
    if (missing.length) {
      await Notification.insertMany(
        missing.map((admin) => ({
          userId: admin._id,
          type: "system",
          title,
          description,
          linkTo: "/dashboard/sponsorships",
          relatedEntityType: "stripe_payment_attempt",
          relatedEntityId: String(attempt._id),
          status: "unread",
        })),
        { ordered: true },
      );
    }
    inAppNotifiedAt = new Date();
  } catch (error) {
    inAppNotificationError = String(error.message || error).slice(0, 1000);
    console.error("Unable to create Stripe payment-attempt notifications:", error.message);
  }

  try {
    const settings = await StripePaymentLinkSettings.findById(
      "organization-stripe-payment-link",
    ).lean();
    const recipient = String(settings?.adminAlertEmail || DEFAULT_ALERT_EMAIL)
      .trim()
      .toLowerCase();
    await sendEmail({
      to: recipient,
      subject: "Stripe payment attempt needs verification",
      text: [
        "A sponsor started a Stripe checkout. This is not confirmation that payment was made.",
        `Sponsor: ${sponsor.profile?.fullName || sponsor.sponsor?.name || "Sponsor"}`,
        `Email: ${sponsor.profile?.email || sponsor.sponsor?.email || "Not provided"}`,
        `Child: ${getChildName(sponsorship.child)}`,
        `Expected amount: ${sponsorship.currency || "USD"} ${attempt.expectedAmount.toFixed(2)}`,
        `Reference: ${attempt.publicReference}`,
        "Please verify the payment in Stripe Dashboard before recording or approving it.",
        `${process.env.WEBSITE_URL || "https://www.seedsoflovefoundation.org"}/dashboard/sponsorships`,
      ].join("\n"),
      html: `<p>A sponsor started a Stripe checkout. This is <strong>not confirmation that payment was made</strong>.</p>
        <p>Sponsor: ${escapeHtml(sponsor.profile?.fullName || sponsor.sponsor?.name || "Sponsor")}<br />
        Child: ${escapeHtml(getChildName(sponsorship.child))}<br />
        Expected amount: ${escapeHtml(`${sponsorship.currency || "USD"} ${attempt.expectedAmount.toFixed(2)}`)}<br />
        Reference: <strong>${escapeHtml(attempt.publicReference)}</strong></p>
        <p>Verify the payment in Stripe Dashboard before recording or approving it.</p>
        <p><a href="${escapeHtml(`${process.env.WEBSITE_URL || "https://www.seedsoflovefoundation.org"}/dashboard/sponsorships`)}">Open sponsorship dashboard</a></p>`,
    });
    adminEmailSentAt = new Date();
  } catch (error) {
    adminEmailError = String(error.message || error).slice(0, 1000);
    console.error("Unable to email Stripe payment-attempt alert:", error.message);
  }

  await StripePaymentAttempt.findByIdAndUpdate(attempt._id, {
    $set: {
      inAppNotifiedAt,
      inAppNotificationError,
      adminEmailSentAt,
      adminEmailError,
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

exports.getStripePaymentPage = async (req, res) => {
  try {
    const tokenRecord = await getValidPaymentPageToken(req.params.token);
    if (!tokenRecord) {
      return res.status(404).json({ message: "This payment link is invalid or has expired." });
    }
    return res.status(200).json(await getPageSummary(tokenRecord));
  } catch (error) {
    console.error("Unable to load Stripe payment page:", error.message);
    return res.status(500).json({ message: "Unable to load this payment page." });
  }
};

exports.startStripePaymentAttempt = async (req, res) => {
  try {
    const tokenRecord = await getValidPaymentPageToken(req.params.token);
    if (!tokenRecord) {
      return res.status(404).json({ message: "This payment link is invalid or has expired." });
    }
    if (!(await getConfiguredPaymentLink()).configured) {
      return res.status(503).json({ message: "Stripe Payment Link is not configured." });
    }
    const sponsorship = tokenRecord.sponsorship;
    const sponsor = sponsorship.donor;
    const expectedAmount = await getExpectedAmountForPage(tokenRecord);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return res.status(409).json({ message: "There is no outstanding amount due for this pledge." });
    }
    const now = new Date();
    await StripePaymentAttempt.updateMany(
      {
        sponsorship: tokenRecord.sponsorship._id,
        dueDateKey: tokenRecord.dueDateKey,
        status: "awaiting_verification",
        expiresAt: { $lte: now },
      },
      { $set: { status: "expired" } },
    );

    let attempt = await StripePaymentAttempt.findOne({
      sponsorship: sponsorship._id,
      dueDateKey: tokenRecord.dueDateKey,
      status: "awaiting_verification",
      expiresAt: { $gt: now },
    });
    if (!attempt) {
      const publicReference = `ENS-${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
      let created = false;
      try {
        attempt = await StripePaymentAttempt.create({
          pageToken: tokenRecord._id,
          sponsorship: sponsorship._id,
          sponsor: sponsor._id,
          publicReference,
          expectedAmount,
          dueDate: tokenRecord.dueDate,
          dueDateKey: tokenRecord.dueDateKey,
          expiresAt: new Date(Math.min(
            now.getTime() + ATTEMPT_TTL_MS,
            tokenRecord.expiresAt.getTime(),
          )),
        });
        created = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        attempt = await StripePaymentAttempt.findOne({
          sponsorship: sponsorship._id,
          dueDateKey: tokenRecord.dueDateKey,
          status: "awaiting_verification",
          expiresAt: { $gt: new Date() },
        });
        if (!attempt) throw error;
      }
      if (attempt && created) await notifyPaymentAttempt(attempt, sponsorship, sponsor);
    }

    const paymentUrl = await getAttemptCheckoutUrl(attempt.publicReference);
    return res.status(200).json({ paymentUrl, reference: attempt.publicReference });
  } catch (error) {
    console.error("Unable to start Stripe payment attempt:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to start Stripe checkout.",
    });
  }
};

exports.getStripePaymentAttempts = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
    await StripePaymentAttempt.updateMany(
      { status: "awaiting_verification", expiresAt: { $lte: new Date() } },
      { $set: { status: "expired" } },
    );
    const filter = {
      $or: [
        { status: { $in: ["awaiting_verification", "needs_management_review"] } },
        {
          status: "expired",
          updatedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      ],
    };
    const [attempts, total] = await Promise.all([
      StripePaymentAttempt.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: "sponsorship",
          populate: [{ path: "donor" }, { path: "child" }],
        }),
      StripePaymentAttempt.countDocuments(filter),
    ]);
    return res.status(200).json({ attempts, total, page, limit });
  } catch (error) {
    console.error("Unable to load Stripe payment attempts:", error.message);
    return res.status(500).json({ message: "Unable to load payment attempts." });
  }
};

exports.approveStripePaymentAttempt = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const actualAmount = Math.round(Number(req.body?.amount) * 100) / 100;
    const stripeReference = String(req.body?.stripeReference || "").trim();
    const paymentDate = req.body?.date ? new Date(req.body.date) : new Date();
    if (
      !Number.isFinite(actualAmount) ||
      actualAmount <= 0 ||
      actualAmount > 100000 ||
      !/^pi_[A-Za-z0-9]+$/.test(stripeReference) ||
      Number.isNaN(paymentDate.getTime())
    ) {
      return res.status(400).json({
        message: "Enter the verified amount, date, and Stripe PaymentIntent ID.",
      });
    }

    let updatedAttempt;
    let sponsorshipStatus;
    await session.withTransaction(async () => {
      const attempt = await StripePaymentAttempt.findById(req.params.id).session(session);
      if (!attempt) {
        const error = new Error("Payment attempt not found.");
        error.statusCode = 404;
        throw error;
      }
      if (!["awaiting_verification", "expired"].includes(attempt.status)) {
        const error = new Error("This payment attempt is not available for verification.");
        error.statusCode = 409;
        throw error;
      }
      if (isStripeOverpayment(actualAmount, attempt.expectedAmount)) {
        attempt.status = "needs_management_review";
        attempt.actualAmount = actualAmount;
        attempt.stripeReference = stripeReference;
        attempt.paymentDate = paymentDate;
        attempt.resolutionNotes =
          "Verified payment exceeds the pledge. Do not approve or count the excess; management resolution is required.";
        await attempt.save({ session });
        updatedAttempt = attempt;
        sponsorshipStatus = "review";
        return;
      }

      const duplicatePayment = await Sponsorships.exists({
        "payments.transactionId": stripeReference,
      }).session(session);
      const duplicateAttempt = await StripePaymentAttempt.exists({
        _id: { $ne: attempt._id },
        stripeReference,
        status: "approved",
      }).session(session);
      if (duplicatePayment || duplicateAttempt) {
        const error = new Error("That Stripe PaymentIntent has already been recorded.");
        error.statusCode = 409;
        throw error;
      }

      const sponsorship = await Sponsorships.findById(attempt.sponsorship).session(session);
      if (!sponsorship) {
        const error = new Error("The linked sponsorship no longer exists.");
        error.statusCode = 404;
        throw error;
      }
      const sponsor = await Sponsor.findById(attempt.sponsor).session(session);
      if (!sponsor || sponsor.paymentMethod !== "stripe") {
        const error = new Error("The linked sponsor is not using Stripe.");
        error.statusCode = 409;
        throw error;
      }
      const previousPaid = Number(sponsorship.totalPaid || 0);
      const nextPaid = Math.round((previousPaid + actualAmount) * 100) / 100;
      const pledgeAmount = Math.round(Number(sponsorship.amount || 0) * 100) / 100;
      const fullyFunded = sponsorship.status !== "Pending" || nextPaid >= pledgeAmount;
      if (sponsorship.status === "Pending" && fullyFunded) {
        const child = await ChildProfile.findById(sponsorship.child).session(session);
        if (!child || (child.sponsorshipStatus !== "Available" &&
          child.sponsor?.toString() !== sponsor._id.toString())) {
          const error = new Error("The child is no longer available; resolve the pledge conflict first.");
          error.statusCode = 409;
          throw error;
        }
        child.sponsor = sponsor._id;
        child.sponsorshipStatus = "Sponsored";
        await child.save({ session });
        sponsorship.status = "Active";
        sponsorship.startDate = sponsorship.startDate || paymentDate;
      }

      sponsorship.payments.push({
        date: paymentDate,
        amount: actualAmount,
        currency: sponsorship.currency || "USD",
        method: "Stripe",
        transactionId: stripeReference,
        paymentGroupId: attempt.publicReference,
        notes: `Manually verified from Stripe Dashboard. Attempt ${attempt.publicReference}.`,
        recordedAt: new Date(),
        recordedBy: req.admin?.id,
        status: "Completed",
      });
      sponsorship.totalPaid = nextPaid;
      sponsorship.lastPayment = paymentDate;
      sponsorship.bankReference = sponsorship.bankReference || stripeReference;
      await sponsorship.save({ session });

      attempt.status = "approved";
      attempt.actualAmount = actualAmount;
      attempt.stripeReference = stripeReference;
      attempt.paymentDate = paymentDate;
      attempt.verifiedBy = req.admin?.id;
      attempt.verifiedAt = new Date();
      await attempt.save({ session });
      updatedAttempt = attempt;
      sponsorshipStatus = sponsorship.status;
    });

    if (sponsorshipStatus === "review") {
      return res.status(409).json({
        message: "The payment exceeds the pledged amount. It is flagged for management review and was not recorded.",
        attempt: updatedAttempt,
      });
    }
    return res.status(200).json({
      message: "Stripe payment verified and recorded.",
      attempt: updatedAttempt,
      sponsorshipStatus,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "That Stripe PaymentIntent has already been recorded." });
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to approve Stripe payment attempt.",
    });
  } finally {
    await session.endSession();
  }
};

exports.expireStripePaymentAttempt = async (req, res) => {
  try {
    const attempt = await StripePaymentAttempt.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ["awaiting_verification", "needs_management_review"] } },
      { $set: { status: "expired", resolutionNotes: String(req.body?.notes || "Expired by staff.").slice(0, 1000) } },
      { new: true, runValidators: true },
    );
    if (!attempt) {
      return res.status(404).json({ message: "Open payment attempt not found." });
    }
    return res.status(200).json({ message: "Payment attempt expired.", attempt });
  } catch (error) {
    console.error("Unable to expire Stripe payment attempt:", error.message);
    return res.status(500).json({ message: "Unable to expire payment attempt." });
  }
};
