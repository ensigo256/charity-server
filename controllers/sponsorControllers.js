const { child } = require("winston");
const Childern = require("../models/childProfile");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const Admin = require("../models/admin");
const deleteImage = require("../utils/deleteCloudImg");
const mongoose = require("mongoose");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const {
  generateSponsorDueReminders,
  calculateNextPaymentDate,
} = require("../utils/notificationUtil");

const ACTIVE_SPONSORSHIP_STATUSES = ["Active", "Pending"];
const CLOSING_SPONSORSHIP_STATUSES = ["Completed", "Cancelled", "Paused"];
const MANUAL_PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Mobile Money",
  "ACH",
  "PayPal",
  "Zelle",
  "Stripe",
  "Check",
  "Other",
];
const PROFILE_COMPLETION_FIELDS = [
  "fullName",
  "email",
  "phone",
  "country",
  "city",
  "state",
  "region",
  "zipCode",
];

const getProfileStatus = (profile) =>
  PROFILE_COMPLETION_FIELDS.every((field) =>
    String(profile?.[field] || "").trim(),
  )
    ? "Complete"
    : "Incomplete";

const getProfileCompletion = (profile) =>
  Math.round(
    (PROFILE_COMPLETION_FIELDS.filter((field) =>
      String(profile?.[field] || "").trim(),
    ).length /
      PROFILE_COMPLETION_FIELDS.length) *
      100,
  );

const getAchInstructions = () => {
  const instructions = {
    beneficiaryName: String(process.env.ACH_BENEFICIARY_NAME || "").trim(),
    bankName: String(process.env.ACH_BANK_NAME || "").trim(),
    routingNumber: String(process.env.ACH_ROUTING_NUMBER || "").trim(),
    accountNumber: String(process.env.ACH_ACCOUNT_NUMBER || "").trim(),
    accountType: String(process.env.ACH_ACCOUNT_TYPE || "").trim(),
    referenceInstructions: String(
      process.env.ACH_REFERENCE_INSTRUCTIONS || "",
    ).trim(),
  };

  return Object.values(instructions).every(Boolean) ? instructions : null;
};

const normalizeSponsorProfile = (data) => {
  const source = data.profile || data.sponsor || {};
  const location = data.location || {};

  return {
    fullName: source.fullName || source.name || data.name || "",
    email: source.email || data.email || "",
    phone: source.phone || data.phone || "",
    country: source.country || location.country || data.country || "",
    city: source.city || location.city || data.city || "",
    state: source.state || location.state || data.state || "",
    region: source.region || location.region || data.region || "",
    zipCode:
      source.zipCode ||
      location.zipCode ||
      location.zip ||
      data.zipCode ||
      data.zip ||
      "",
    bio: source.bio || data.bio || "",
  };
};

const syncChildSponsorState = async (
  childId,
  sponsorId,
  status = "Sponsored",
) => {
  if (!childId) return;

  const childProfile = await Childern.findById(childId);
  if (!childProfile) return;

  const isActive = ["Active", "Pending"].includes(status);

  childProfile.sponsor = isActive ? sponsorId : null;
  childProfile.sponsorshipStatus = isActive ? "Sponsored" : "Available";
  await childProfile.save();
};

const upsertSponsorSponsorship = async ({
  childId,
  sponsorId,
  donation,
  data,
}) => {
  if (!childId || !sponsorId) return null;

  const existingSponsorship = await Sponsorships.findOne({
    child: childId,
  }).sort({ createdAt: -1 });

  if (!existingSponsorship) {
    const newSponsorship = new Sponsorships({
      child: childId,
      donor: sponsorId,
      startDate: data.startDate ? new Date(data.startDate) : new Date(),
      endDate: data.endDate ? new Date(data.endDate) : null,
      amount: donation.amount || 0,
      frequency: donation.period || "Monthly",
      expectedFundsDate: data.expectedFundsDate
        ? new Date(data.expectedFundsDate)
        : donation.expectedFundsDate
          ? new Date(donation.expectedFundsDate)
          : null,
      status: (data.status || "Pending").trim() || "Pending",
      payments: [],
      lastPayment: null,
      totalPaid: 0,
      notes: data.notes || "",
    });

    await newSponsorship.save();
    await syncChildSponsorState(childId, sponsorId, newSponsorship.status);
    return newSponsorship;
  }

  existingSponsorship.donor = sponsorId;
  existingSponsorship.amount =
    donation.amount || existingSponsorship.amount || 0;
  existingSponsorship.frequency =
    donation.period || existingSponsorship.frequency || "Monthly";
  existingSponsorship.expectedFundsDate = data.expectedFundsDate
    ? new Date(data.expectedFundsDate)
    : existingSponsorship.expectedFundsDate || null;
  existingSponsorship.startDate =
    existingSponsorship.startDate || new Date(data.startDate || Date.now());
  existingSponsorship.endDate = data.endDate
    ? new Date(data.endDate)
    : existingSponsorship.endDate;
  existingSponsorship.status = data.status || "Active";
  existingSponsorship.notes = data.notes || existingSponsorship.notes || "";
  await existingSponsorship.save();
  await syncChildSponsorState(childId, sponsorId, existingSponsorship.status);
  return existingSponsorship;
};

//create sponsor
exports.createSponsor = async (req, res) => {
  try {
    const data = req.body;
    const profile = normalizeSponsorProfile(data);
    const safeSponsor = {
      email: profile.email,
      name: profile.fullName,
      phone: profile.phone,
    };

    const paymentMethod =
      typeof data.paymentMethod === "string"
        ? data.paymentMethod
        : data.paymentMethod?.paymentMethod ||
          data.paymentMethod?.method ||
          "Not specified";

    const donation = {
      ...(data.donation || {
        amount: Number(data.amount || 0),
        period: data.period || "Monthly",
      }),
      amount: Number((data.donation?.amount ?? data.amount ?? 0) || 0),
      period: data.donation?.period || data.period || "Monthly",
      remindByEmail: Boolean(data.donation?.remindByEmail ?? data.remindByEmail ?? true),
    };

    if (data.expectedFundsDate || data.donation?.expectedFundsDate) {
      donation.expectedFundsDate = new Date(
        data.donation?.expectedFundsDate || data.expectedFundsDate,
      );
    }

    const childId = data.childId || data.child || null;

    const payLoad = {
      ...data,
      profile,
      sponsor: safeSponsor,
      child: childId,
      paymentMethod,
      donation,
      profileStatus: getProfileStatus(profile),
      source: data.source || "website",
    };

    const newSponsor = new Sponsor(payLoad);
    await newSponsor.save();

    if (childId) {
      await upsertSponsorSponsorship({
        childId,
        sponsorId: newSponsor._id,
        donation,
        data,
      });
    }

    res.status(201).json({
      message: "Sponsor created successfully",
      sponsor: newSponsor,
      profileStatus: newSponsor.profileStatus,
      profileCompletion: getProfileCompletion(newSponsor.profile),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.createPublicPledge = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { profile: incomingProfile, location = {}, donation, childId, requestId } =
      req.body || {};
    const paymentMethod = String(req.body?.paymentMethod || "").toLowerCase();
    const instructions = getAchInstructions();

    if (!instructions) {
      return res.status(503).json({
        message: "Manual bank transfer instructions are not configured yet.",
      });
    }
    if (paymentMethod !== "ach") {
      return res.status(400).json({
        message: "Only manual ACH transfers are currently available online.",
      });
    }
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ message: "A valid child is required." });
    }
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(String(requestId || ""))) {
      return res.status(400).json({ message: "A valid request identifier is required." });
    }

    const existingPledge = await Sponsorships.findOne({
      publicRequestId: String(requestId),
    });
    if (existingPledge) {
      return res.status(200).json({
        message: "This pledge has already been submitted.",
        pledge: {
          id: existingPledge._id,
          reference: existingPledge.publicPledgeReference,
          amount: existingPledge.amount,
          currency: existingPledge.currency || "USD",
          period: existingPledge.frequency,
          status: existingPledge.status,
        },
        achInstructions: instructions,
      });
    }

    const profile = normalizeSponsorProfile({
      profile: incomingProfile,
      location,
    });
    const email = String(profile.email || "").trim().toLowerCase();
    const amount = Number(donation?.amount);
    const period = String(donation?.period || "");
    const allowedPeriods = ["Monthly", "3 Months", "6 Months", "Yearly"];

    if (
      !profile.fullName ||
      profile.fullName.length < 2 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      !profile.phone ||
      !Number.isFinite(amount) ||
      amount < 5 ||
      amount > 100000 ||
      !allowedPeriods.includes(period)
    ) {
      return res.status(400).json({
        message: "Please provide valid sponsor and pledge details.",
      });
    }

    const child = await Childern.findOne({
      _id: childId,
      sponsorshipStatus: "Available",
    });
    if (!child) {
      return res.status(409).json({
        message: "This child is no longer available for sponsorship.",
      });
    }

    const profileImage = req.body?.image;
    if (
      profileImage &&
      (!/^https:\/\//i.test(String(profileImage.url || "")) ||
        !String(profileImage.public_id || "").trim())
    ) {
      return res.status(400).json({ message: "Sponsor image is invalid." });
    }

    const pledgeReference = `ACH-${new mongoose.Types.ObjectId().toString().toUpperCase()}`;
    let sponsor;
    let sponsorship;

    await session.withTransaction(async () => {
      const availableChild = await Childern.findOne({
        _id: childId,
        sponsorshipStatus: "Available",
      }).session(session);
      if (!availableChild) {
        const error = new Error(
          "This child is no longer available for sponsorship.",
        );
        error.statusCode = 409;
        throw error;
      }

      const safeSponsor = {
        name: profile.fullName,
        email,
        phone: profile.phone,
      };
      [sponsor] = await Sponsor.create(
        [
          {
            profile: { ...profile, email },
            sponsor: safeSponsor,
            image: profileImage
              ? {
                  url: String(profileImage.url),
                  public_id: String(profileImage.public_id),
                }
              : undefined,
            location: {
              address: String(location.address || "").trim(),
              country: String(location.country || "").trim(),
              city: String(location.city || "").trim(),
              state: String(location.state || "").trim(),
              region: String(location.region || "").trim(),
              zipCode: String(location.zipCode || "").trim(),
            },
            child: child._id,
            donation: {
              amount,
              period,
              remindByEmail: donation.remindByEmail !== false,
            },
            paymentMethod: "ach",
            profileStatus: getProfileStatus(profile),
            source: "website",
          },
        ],
        { session },
      );

      [sponsorship] = await Sponsorships.create(
        [
          {
            child: child._id,
            donor: sponsor._id,
            publicPledgeReference: pledgeReference,
            publicRequestId: String(requestId),
            startDate: new Date(),
            amount,
            currency: "USD",
            frequency: period,
            status: "Pending",
            payments: [],
            totalPaid: 0,
            notes: "Public manual ACH pledge; awaiting bank transfer.",
          },
        ],
        { session },
      );
    });

    return res.status(201).json({
      message: "Pledge submitted. It will remain pending until the transfer is verified.",
      pledge: {
        id: sponsorship._id,
        reference: pledgeReference,
        amount,
        currency: "USD",
        period,
        status: sponsorship.status,
      },
      achInstructions: instructions,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existingPledge = await Sponsorships.findOne({
        publicRequestId: String(req.body?.requestId || ""),
      });
      if (existingPledge) {
        return res.status(200).json({
          message: "This pledge has already been submitted.",
          pledge: {
            id: existingPledge._id,
            reference: existingPledge.publicPledgeReference,
            amount: existingPledge.amount,
            currency: existingPledge.currency || "USD",
            period: existingPledge.frequency,
            status: existingPledge.status,
          },
          achInstructions: getAchInstructions(),
        });
      }
      return res.status(409).json({ message: "This pledge was already recorded." });
    }
    console.error("Unable to create public pledge:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to submit pledge.",
    });
  } finally {
    await session.endSession();
  }
};

exports.confirmPublicAchPledge = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { amount, date, bankReference, notes = "" } = req.body || {};
    const normalizedReference = String(bankReference || "").trim();
    const receivedAmount = Number(amount);
    const receivedDate = date ? new Date(date) : new Date();

    if (
      !normalizedReference ||
      !Number.isFinite(receivedAmount) ||
      receivedAmount <= 0 ||
      Number.isNaN(receivedDate.getTime())
    ) {
      return res.status(400).json({
        message: "Received amount, date, and bank reference are required.",
      });
    }

    let updatedSponsorship;
    await session.withTransaction(async () => {
      const sponsorship = await Sponsorships.findById(req.params.id).session(
        session,
      );
      if (!sponsorship || !sponsorship.publicPledgeReference) {
        const error = new Error("Pending public pledge not found.");
        error.statusCode = 404;
        throw error;
      }
      if (sponsorship.status !== "Pending") {
        const error = new Error("This pledge is no longer pending.");
        error.statusCode = 409;
        throw error;
      }

      const child = await Childern.findById(sponsorship.child).session(session);
      if (!child || child.sponsorshipStatus !== "Available") {
        const error = new Error(
          "The child is no longer available; resolve the pledge conflict before confirming.",
        );
        error.statusCode = 409;
        throw error;
      }

      sponsorship.payments.push({
        date: receivedDate,
        amount: receivedAmount,
        currency: "USD",
        method: "ACH",
        transactionId: normalizedReference,
        notes: String(notes).trim(),
        recordedAt: new Date(),
        recordedBy: req.admin?.id,
        status: "Completed",
      });
      sponsorship.bankReference = normalizedReference;
      sponsorship.status = "Active";
      sponsorship.totalPaid = (sponsorship.totalPaid || 0) + receivedAmount;
      sponsorship.lastPayment = receivedDate;
      sponsorship.startDate = sponsorship.startDate || receivedDate;
      await sponsorship.save({ session });

      child.sponsor = sponsorship.donor;
      child.sponsorshipStatus = "Sponsored";
      await child.save({ session });
      updatedSponsorship = sponsorship;
    });

    return res.status(200).json({
      message: "ACH receipt recorded and sponsorship activated.",
      sponsorship: updatedSponsorship,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "That bank reference has already been recorded.",
      });
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to confirm ACH pledge.",
    });
  } finally {
    await session.endSession();
  }
};

exports.cancelPublicPledge = async (req, res) => {
  try {
    const sponsorship = await Sponsorships.findOneAndUpdate(
      {
        _id: req.params.id,
        publicPledgeReference: { $exists: true, $ne: "" },
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          notes: String(req.body?.notes || "Pledge cancelled by staff.").trim(),
        },
      },
      { new: true, runValidators: true },
    );

    if (!sponsorship) {
      return res.status(404).json({ message: "Pending public pledge not found." });
    }
    return res.status(200).json({
      message: "Pending pledge cancelled.",
      sponsorship,
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to cancel pledge." });
  }
};

exports.getSponsorRecords = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [sponsors, total] = await Promise.all([
      Sponsorships.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate([{ path: "child" }, { path: "donor" }]),
      Sponsorships.countDocuments(),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(sponsors);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getProfiles = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const filter = { isArchived: { $ne: true } };
    const [profiles, total] = await Promise.all([
      Sponsor.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Sponsor.countDocuments(filter),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(profiles);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "server error" });
  }
};

exports.archiveSponsorProfile = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid sponsor id" });
    }

    const sponsor = await Sponsor.findById(id);
    if (!sponsor) {
      return res.status(404).json({ message: "Sponsor not found" });
    }

    if (sponsor.isArchived) {
      return res.status(200).json({
        message: "Sponsor profile is already archived",
        sponsor,
      });
    }

    const sponsorships = await Sponsorships.find({
      donor: sponsor._id,
      status: { $in: ACTIVE_SPONSORSHIP_STATUSES },
    });

    await Sponsorships.updateMany(
      { donor: sponsor._id, status: { $in: ACTIVE_SPONSORSHIP_STATUSES } },
      { $set: { status: "Cancelled" } },
    );

    const childIds = sponsorships.map((sponsorship) => sponsorship.child);
    if (childIds.length > 0) {
      await Childern.updateMany(
        { _id: { $in: childIds }, sponsor: sponsor._id },
        { $set: { sponsor: null, sponsorshipStatus: "Available" } },
      );
    }

    const archivedSponsor = await Sponsor.findByIdAndUpdate(
      sponsor._id,
      {
        $set: {
          child: null,
          isArchived: true,
          archivedAt: new Date(),
        },
      },
      { new: true },
    );

    return res.status(200).json({
      message: "Sponsor profile archived successfully",
      sponsor: archivedSponsor,
      releasedChildren: childIds.length,
      preservedSponsorships: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to archive sponsor profile",
      error: error.message,
    });
  }
};

exports.getSponsorById = async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) {
      return res.status(404).json({ message: "Sponsor not found" });
    }

    const sponsorships = await Sponsorships.find({ donor: req.params.id })
      .populate("child")
      .populate("donor")
      .sort({ createdAt: -1 });

    const children = sponsorships.map((item) => ({
      _id: item._id,
      child: item.child,
      status: item.status,
      amount: item.amount,
      totalPaid: item.totalPaid || 0,
      lastPayment: item.lastPayment,
      startDate: item.startDate,
      frequency: item.frequency,
      payments: item.payments || [],
    }));

    const paymentHistory = sponsorships
      .flatMap((item) =>
        (item.payments || []).map((payment) => ({
          ...(typeof payment.toObject === "function"
            ? payment.toObject()
            : payment),
          sponsorshipId: item._id,
          child: item.child,
          donor: item.donor,
        })),
      )
      .sort(
        (left, right) => new Date(right.date || 0) - new Date(left.date || 0),
      );

    const totalPledged = sponsorships.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0,
    );
    const totalPaid = sponsorships.reduce(
      (sum, item) => sum + (Number(item.totalPaid) || 0),
      0,
    );
    const activeChildren = sponsorships.filter(
      (item) => item.status === "Active",
    ).length;

    const latestPaymentDate = sponsorships.reduce((latest, item) => {
      const dates = [
        item.lastPayment,
        ...((item.payments || []).map((payment) => payment.date).filter(Boolean)),
      ]
        .map((date) => (date ? new Date(date) : null))
        .filter((date) => date && !Number.isNaN(date.getTime()));

      if (dates.length === 0) return latest;
      const newest = new Date(Math.max(...dates.map((date) => date.getTime())));
      return !latest || newest > latest ? newest : latest;
    }, null);

    const nextPaymentDate = sponsorships.reduce((next, item) => {
      const paymentPeriod = item.frequency || sponsor.donation?.period || "Monthly";
      const lastDate = item.lastPayment || item.startDate || item.createdAt;
      const explicitExpectation = item.expectedFundsDate || sponsor.donation?.expectedFundsDate;
      const candidate = calculateNextPaymentDate({
        lastPaymentDate: lastDate,
        paymentPeriod,
        startDate: item.startDate,
        expectedFundsDate: explicitExpectation,
      });

      if (!candidate || Number.isNaN(candidate.getTime())) return next;
      return !next || candidate < next ? candidate : next;
    }, null);

    res.status(200).json({
      sponsor,
      profileStatus: sponsor.profileStatus || getProfileStatus(sponsor.profile),
      profileCompletion: getProfileCompletion(sponsor.profile),
      children,
      paymentHistory,
      summary: {
        totalChildren: sponsorships.length,
        activeChildren,
        pendingChildren: sponsorships.filter(
          (item) => item.status === "Pending",
        ).length,
        totalPledged,
        totalPaid,
        lastPaymentDate: latestPaymentDate ? latestPaymentDate.toISOString() : null,
        nextPaymentDate: nextPaymentDate ? nextPaymentDate.toISOString() : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateSponsorProfile = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "email",
      "phone",
      "country",
      "city",
      "state",
      "region",
      "zipCode",
      "bio",
    ];
    const incoming = req.body.profile || req.body;
    const profile = {};
    const image = req.body.image;
    const donationUpdate = req.body.donation || {};

    allowedFields.forEach((field) => {
      if (incoming[field] !== undefined)
        profile[field] = String(incoming[field]).trim();
    });

    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    const legacyProfile = normalizeSponsorProfile({
      sponsor: sponsor.sponsor,
      location: sponsor.location,
    });
    const mergedProfile = {
      ...legacyProfile,
      ...(sponsor.profile?.toObject?.() || sponsor.profile || {}),
      ...profile,
    };
    const profileStatus = getProfileStatus(mergedProfile);

    if (image !== undefined && (!image?.url || !image?.public_id)) {
      return res.status(400).json({
        message: "Both image URL and public ID are required.",
      });
    }

    const previousImageId = sponsor.image?.public_id;
    const update = {
      profile: mergedProfile,
      profileStatus,
      source: "dashboard",
    };

    if (Object.keys(donationUpdate).length > 0) {
      const nextDonation = {
        ...(sponsor.donation?.toObject?.() || sponsor.donation || {}),
        ...donationUpdate,
      };

      if (donationUpdate.expectedFundsDate === null || donationUpdate.expectedFundsDate === "") {
        nextDonation.expectedFundsDate = null;
      } else if (donationUpdate.expectedFundsDate) {
        nextDonation.expectedFundsDate = new Date(donationUpdate.expectedFundsDate);
      }

      update.donation = nextDonation;
    }

    if (image !== undefined) {
      update.image = {
        url: String(image.url).trim(),
        public_id: String(image.public_id).trim(),
      };
    }

    await Sponsor.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    );

    if (
      image !== undefined &&
      previousImageId &&
      previousImageId !== image.public_id
    ) {
      await deleteImage(previousImageId, "image");
    }

    const updatedSponsor = await Sponsor.findById(req.params.id);
    res.status(200).json({
      message: "Sponsor profile updated successfully",
      sponsor: updatedSponsor,
      profileStatus,
      profileCompletion: getProfileCompletion(updatedSponsor.profile),
    });
  } catch (error) {
    res.status(400).json({
      message: "Unable to update sponsor profile",
      error: error.message,
    });
  }
};

exports.createPaymentRecord = async (req, res) => {
  try {
    const data = req.body;
    const sponsorship = await Sponsorships.findById(req.params.id);
    if (!sponsorship) {
      return res.status(404).json({ message: "Sponsorship record not found" });
    }
    if (sponsorship.publicPledgeReference) {
      return res.status(409).json({
        message: "Record public ACH receipts through the pledge confirmation workflow.",
      });
    }
    const newPayment = {
      date: new Date(),
      amount: data.amount,
      method: data.method,
      transactionId: data.transactionId,
      notes: data.notes || "",
      status: data.amount > 0 ? "Completed" : "Pending",
    };
    sponsorship.payments.push(newPayment);
    sponsorship.status = "Active";
    sponsorship.totalPaid =
      (sponsorship.totalPaid || 0) + Number(data.amount || 0);
    sponsorship.lastPayment = new Date();
    await sponsorship.save();
    res.status(201).json({
      message: "Payment record created successfully",
      payment: newPayment,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.recordSplitPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { sponsorId } = req.params;
    const {
      amount,
      currency = "UGX",
      date,
      method,
      transactionId,
      notes = "",
      allocationMode = "custom",
      allocations = [],
    } = req.body;

    if (!mongoose.isValidObjectId(sponsorId)) {
      return res.status(400).json({ message: "Invalid sponsor id" });
    }

    const totalAmount = Number(amount);
    if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
      return res
        .status(400)
        .json({ message: "Donation amount must be a positive whole number." });
    }

    if (!MANUAL_PAYMENT_METHODS.includes(method)) {
      return res
        .status(400)
        .json({ message: "A valid manual payment method is required." });
    }

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res
        .status(400)
        .json({ message: "Select at least one child sponsorship." });
    }

    const sponsor = await Sponsor.findById(sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });
    if (sponsor.isArchived) {
      return res
        .status(409)
        .json({ message: "Archived sponsors cannot receive payments." });
    }

    const sponsorshipIds = allocations.map(
      (allocation) => allocation.sponsorshipId,
    );
    const childIds = allocations.map((allocation) => allocation.childId);
    if (
      sponsorshipIds.some((id) => !mongoose.isValidObjectId(id)) ||
      childIds.some((id) => !mongoose.isValidObjectId(id)) ||
      new Set(sponsorshipIds).size !== sponsorshipIds.length ||
      new Set(childIds).size !== childIds.length
    ) {
      return res
        .status(400)
        .json({ message: "Allocations contain invalid or duplicate records." });
    }

    const sponsorships = await Sponsorships.find({
      _id: { $in: sponsorshipIds },
      donor: sponsorId,
    });

    if (sponsorships.length !== allocations.length) {
      return res.status(400).json({
        message: "One or more sponsorships do not belong to this sponsor.",
      });
    }

    const sponsorshipById = new Map(
      sponsorships.map((item) => [String(item._id), item]),
    );
    const normalizedAllocations = allocations.map((allocation) => {
      const sponsorship = sponsorshipById.get(String(allocation.sponsorshipId));
      const allocationAmount = Number(allocation.amount);

      if (
        !sponsorship ||
        String(sponsorship.child?._id || sponsorship.child) !==
          String(allocation.childId)
      ) {
        throw new Error("Each child must match its sponsorship record.");
      }
      if (!ACTIVE_SPONSORSHIP_STATUSES.includes(sponsorship.status)) {
        throw new Error(
          "Payments can only be recorded for active sponsorships.",
        );
      }
      if (
        allocationMode !== "equal" &&
        (!Number.isInteger(allocationAmount) || allocationAmount <= 0)
      ) {
        throw new Error("Every allocation must be a positive whole number.");
      }

      return { sponsorship, amount: allocationAmount };
    });

    let finalAllocations = normalizedAllocations;
    if (allocationMode === "equal") {
      const baseAmount = Math.floor(totalAmount / normalizedAllocations.length);
      const remainder = totalAmount % normalizedAllocations.length;
      finalAllocations = normalizedAllocations.map((allocation, index) => ({
        ...allocation,
        amount: baseAmount + (index < remainder ? 1 : 0),
      }));
    }

    if (finalAllocations.some((allocation) => allocation.amount <= 0)) {
      return res.status(400).json({
        message:
          "The donation must be large enough to give each selected child an amount.",
      });
    }

    const allocatedTotal = finalAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    if (allocatedTotal !== totalAmount) {
      return res
        .status(400)
        .json({ message: "Allocated amounts must equal the donation total." });
    }

    const normalizedTransactionId = String(
      transactionId || `MANUAL-${Date.now()}`,
    ).trim();
    if (!normalizedTransactionId) {
      return res
        .status(400)
        .json({ message: "A payment reference is required." });
    }

    const duplicatePayment = await Sponsorships.exists({
      payments: { $elemMatch: { transactionId: normalizedTransactionId } },
    });
    if (duplicatePayment) {
      return res
        .status(409)
        .json({ message: "This payment reference has already been recorded." });
    }

    const paymentGroupId = `GROUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const paymentDate = date ? new Date(date) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ message: "Invalid payment date." });
    }

    session.startTransaction();
    const createdPayments = [];
    for (const allocation of finalAllocations) {
      const payment = {
        date: paymentDate,
        amount: allocation.amount,
        currency: String(currency).trim() || "UGX",
        method,
        transactionId: normalizedTransactionId,
        paymentGroupId,
        notes: String(notes).trim(),
        recordedAt: new Date(),
        recordedBy: req.admin?.id,
        status: "Completed",
      };

      allocation.sponsorship.payments.push(payment);
      allocation.sponsorship.totalPaid =
        (allocation.sponsorship.totalPaid || 0) + allocation.amount;
      allocation.sponsorship.lastPayment = paymentDate;
      await allocation.sponsorship.save({ session });
      createdPayments.push({
        sponsorshipId: allocation.sponsorship._id,
        childId: allocation.sponsorship.child,
        amount: allocation.amount,
        payment,
      });
    }
    await session.commitTransaction();

    return res.status(201).json({
      message: "Donation recorded successfully",
      paymentGroupId,
      payments: createdPayments,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    const status =
      error.message.includes("sponsorship") ||
      error.message.includes("allocation")
        ? 400
        : 500;
    return res
      .status(status)
      .json({ message: "Unable to record donation", error: error.message });
  } finally {
    await session.endSession();
  }
};

exports.getSponsorChildren = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const filter = { donor: req.params.id };
    const [sponsorships, total] = await Promise.all([
      Sponsorships.find(filter)
        .populate("child")
        .populate("donor")
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Sponsorships.countDocuments(filter),
    ]);

    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(sponsorships);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getChildSponsor = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const filter = { child: req.params.childId };
    const [sponsorships, total] = await Promise.all([
      Sponsorships.find(filter)
        .populate("child")
        .populate("donor")
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Sponsorships.countDocuments(filter),
    ]);

    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(sponsorships);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateSponsorshipStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = [
      "Active",
      "Pending",
      "Paused",
      "Completed",
      "Cancelled",
    ];

    if (!status || !validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ message: "A valid sponsorship status is required." });
    }

    const sponsorship = await Sponsorships.findById(req.params.id).populate(
      "child",
    );
    if (!sponsorship) {
      return res.status(404).json({ message: "Sponsorship record not found" });
    }
    if (sponsorship.publicPledgeReference) {
      return res.status(409).json({
        message: "Use the public pledge receipt confirmation or cancellation action.",
      });
    }

    sponsorship.status = status;
    await sponsorship.save();

    if (sponsorship.child) {
      const isActive = ["Active", "Pending"].includes(status);
      sponsorship.child.sponsor = isActive ? sponsorship.donor : null;
      sponsorship.child.sponsorshipStatus = isActive
        ? "Sponsored"
        : "Available";
      await sponsorship.child.save();
    }

    res.status(200).json({
      message: "Sponsorship status updated successfully",
      sponsorship,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.checkSponsorReminderNotifications = async (req, res) => {
  try {
    const admins = await Admin.find({ isActive: true }).select("_id");
    if (!admins.length) {
      return res.status(200).json({ count: 0, notifications: [] });
    }

    const sponsorships = await Sponsorships.find({
      status: { $in: ["Active", "Pending"] },
    })
      .populate("donor")
      .sort({ lastPayment: 1, createdAt: -1 });

    const sponsorSummaries = sponsorships.map((sponsorship) => {
      const donor = sponsorship.donor || {};
      return {
        _id: donor._id || sponsorship.donor,
        profile: donor.profile || {},
        sponsor: donor.sponsor || {},
        donation: donor.donation || {
          amount: sponsorship.amount,
          period: sponsorship.frequency || "Monthly",
        },
        email: donor.profile?.email || donor.email || "",
        amount: sponsorship.amount,
        lastPaymentDate: sponsorship.lastPayment || sponsorship.startDate || sponsorship.createdAt,
        paymentPeriod: sponsorship.frequency || donor.donation?.period || "Monthly",
        startDate: sponsorship.startDate,
        frequency: sponsorship.frequency,
        expectedFundsDate: sponsorship.expectedFundsDate || donor.donation?.expectedFundsDate,
      };
    });

    const notifications = await generateSponsorDueReminders({
      sponsors: sponsorSummaries,
      userIds: admins.map((admin) => admin._id),
      referenceDate: new Date(),
      dueWindowDays: 7,
    });

    return res.status(200).json({
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to generate sponsor reminder notifications",
      error: error.message,
    });
  }
};

exports.reassignSponsor = async (req, res) => {
  try {
    const data = req.body;
    const childId = data.childId || data.child || req.params.childId;

    if (!childId) {
      return res
        .status(400)
        .json({ message: "Child id is required for sponsor reassignment." });
    }

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ message: "Invalid child id" });
    }

    const childProfile = await Childern.findById(childId);
    if (!childProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }

    const currentSponsorship = await Sponsorships.findOne({
      child: childId,
      status: { $in: ACTIVE_SPONSORSHIP_STATUSES },
    });
    if (childProfile.sponsor || currentSponsorship) {
      return res.status(409).json({
        message: "This child already has an active sponsor.",
      });
    }

    let targetSponsor = null;
    const sponsorId = data.sponsorId || data.sponsor?._id || null;

    if (sponsorId) {
      targetSponsor = await Sponsor.findById(sponsorId);
      if (!targetSponsor) {
        return res.status(404).json({ message: "Sponsor not found" });
      }
      if (targetSponsor.isArchived) {
        return res
          .status(409)
          .json({ message: "Archived sponsors cannot be assigned." });
      }
    }

    if (!targetSponsor) {
      const profile = normalizeSponsorProfile(data);
      const safeSponsor = {
        email: profile.email,
        name: profile.fullName,
        phone: profile.phone,
      };

      if (!profile.fullName || !profile.email || !profile.phone) {
        return res
          .status(400)
          .json({ message: "Sponsor name, email and phone are required." });
      }

      targetSponsor = new Sponsor({
        profile,
        sponsor: safeSponsor,
        child: childId,
        location: data.location || {},
        donation: {
          ...(data.donation || {
            amount: Number(data.amount || 0),
            period: data.period || "Monthly",
          }),
          remindByEmail: data.donation?.remindByEmail ?? data.remindByEmail ?? true,
        },
        paymentMethod: data.paymentMethod || "zelle",
      });

      await targetSponsor.save();
    }

    const donation = {
      ...(data.donation || {
        amount: Number(data.amount || 0),
        period: data.period || "Monthly",
      }),
      remindByEmail: data.donation?.remindByEmail ?? data.remindByEmail ?? true,
    };

    const sponsorship = await upsertSponsorSponsorship({
      childId,
      sponsorId: targetSponsor._id,
      donation,
      data,
    });

    await syncChildSponsorState(
      childId,
      targetSponsor._id,
      sponsorship?.status || "Active",
    );

    return res.status(200).json({
      message: "Sponsor reassigned successfully",
      sponsor: targetSponsor,
      sponsorship,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.unlinkChildSponsor = async (req, res) => {
  try {
    const { childId } = req.params;

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ message: "Invalid child id" });
    }

    const childProfile = await Childern.findById(childId);
    if (!childProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }

    const result = await Sponsorships.updateMany(
      { child: childId, status: { $in: ACTIVE_SPONSORSHIP_STATUSES } },
      { $set: { status: "Cancelled" } },
    );

    const updatedChild = await Childern.findByIdAndUpdate(
      childId,
      { $set: { sponsor: null, sponsorshipStatus: "Available" } },
      { new: true },
    );

    return res.status(200).json({
      message: "Sponsor unlinked successfully",
      child: updatedChild,
      cancelledSponsorships: result.modifiedCount,
      preservedHistory: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to unlink sponsor",
      error: error.message,
    });
  }
};
