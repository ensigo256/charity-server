const { child } = require("winston");
const Childern = require("../models/childProfile");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const AchSettings = require("../models/achSettings");
const Admin = require("../models/admin");
const Notification = require("../models/notification");
const deleteImage = require("../utils/deleteCloudImg");
const mongoose = require("mongoose");
const { sendEmail } = require("../utils/mail");
const { deliverAchInstructions } = require("../utils/achInstructionDelivery");
const { buildStripeCheckoutSessionData } = require("../utils/stripeCheckout");
const { getConfiguredPaymentLink } = require("./stripePaymentLinkSettingsController");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const { getStripeSessionValidationError } = require("../utils/stripePaymentValidation");
const { isValidCloudinaryImageReference } = require("../utils/cloudinaryImageReference");
const { pickEditableDonationFields } = require("../utils/sponsorProfileInput");
const { normalizeManualPaymentInput } = require("../utils/manualPaymentInput");

function normalizeSplitPaymentAllocationInput(payload = {}) {
  const totalAmount = Number(payload.amount);
  const currency = String(payload.currency || "UGX").trim().toUpperCase();
  const allocationMode = payload.allocationMode === "equal" ? "equal" : "custom";
  const rawAllocations = Array.isArray(payload.allocations) ? payload.allocations : [];

  if (!Number.isInteger(totalAmount) || totalAmount <= 0 || totalAmount > 1000000) {
    throw new Error("Donation amount must be a positive whole number no greater than 1,000,000.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  if (rawAllocations.length === 0 || rawAllocations.length > 50) {
    throw new Error("Select between 1 and 50 allocations.");
  }

  const allocations = rawAllocations.map((allocation) => {
    const sponsorshipId = String(allocation?.sponsorshipId || "").trim();
    const childId = String(allocation?.childId || "").trim();
    const amount = Number(allocation?.amount);

    if (!mongoose.isValidObjectId(sponsorshipId) || !mongoose.isValidObjectId(childId)) {
      throw new Error("Allocations contain invalid or duplicate records.");
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
      throw new Error("Every allocation must be a positive whole number.");
    }

    return { sponsorshipId, childId, amount };
  });

  const uniqueSponsorshipIds = new Set(allocations.map((allocation) => allocation.sponsorshipId));
  const uniqueChildIds = new Set(allocations.map((allocation) => allocation.childId));
  if (uniqueSponsorshipIds.size !== allocations.length || uniqueChildIds.size !== allocations.length) {
    throw new Error("Allocations contain invalid or duplicate records.");
  }

  let finalAllocations = allocations;
  if (allocationMode === "equal") {
    const baseAmount = Math.floor(totalAmount / allocations.length);
    const remainder = totalAmount % allocations.length;
    finalAllocations = allocations.map((allocation, index) => ({
      ...allocation,
      amount: baseAmount + (index < remainder ? 1 : 0),
    }));
  }

  const allocatedTotal = finalAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (allocatedTotal !== totalAmount) {
    throw new Error("Allocated amounts must equal the donation total.");
  }

  return { totalAmount, currency, allocationMode, allocations: finalAllocations };
}
const {
  generateSponsorDueReminders,
  calculateNextPaymentDate,
} = require("../utils/notificationUtil");

const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

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

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

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
        emailDelivery: {
          status: existingPledge.achInstructionEmail?.status || "unknown",
          attempts: existingPledge.achInstructionEmail?.attempts || 0,
        },
      });
    }

    if (!(await AchSettings.exists({ _id: "organization-ach" }))) {
      return res.status(503).json({
        message: "Manual bank transfer instructions are not configured yet.",
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
    if (profileImage && !isValidCloudinaryImageReference(profileImage)) {
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
            achInstructionEmail: { status: "pending", attempts: 0 },
            totalPaid: 0,
            notes: "Public manual ACH pledge; awaiting bank transfer.",
          },
        ],
        { session },
      );
    });

    const emailDelivery = await deliverAchInstructions(sponsorship._id);

    return res.status(201).json({
      message: emailDelivery.status === "sent"
        ? "Pledge submitted. Transfer instructions were emailed and the pledge remains pending until funds are verified."
        : "Pledge submitted, but transfer instructions could not be emailed. An administrator can retry delivery.",
      pledge: {
        id: sponsorship._id,
        reference: pledgeReference,
        amount,
        currency: "USD",
        period,
        status: sponsorship.status,
      },
      emailDelivery,
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
          emailDelivery: {
            status: existingPledge.achInstructionEmail?.status || "unknown",
            attempts: existingPledge.achInstructionEmail?.attempts || 0,
          },
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

exports.createPublicStripePaymentLinkPledge = async (req, res) => {
  const paymentLink = await getConfiguredPaymentLink();
  if (!paymentLink.configured) {
    return res.status(503).json({ message: "Stripe donations are not configured yet." });
  }
  const paymentLinkUrl = paymentLink.paymentLinkUrl;
  const paymentUrlForReference = (reference) => {
    const url = new URL(paymentLinkUrl);
    url.searchParams.set("client_reference_id", reference);
    return url.toString();
  };

  const session = await mongoose.startSession();
  try {
    const { profile: incomingProfile, location = {}, donation, childId, requestId } =
      req.body || {};
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ message: "A valid child is required." });
    }
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(String(requestId || ""))) {
      return res.status(400).json({ message: "A valid request identifier is required." });
    }

    const existingPledge = await Sponsorships.findOne({ publicRequestId: String(requestId) });
    if (existingPledge) {
      return res.status(200).json({
        message: "This pledge has already been submitted.",
        paymentUrl: paymentUrlForReference(existingPledge.publicPledgeReference),
        pledge: {
          id: existingPledge._id,
          reference: existingPledge.publicPledgeReference,
          amount: existingPledge.amount,
          currency: existingPledge.currency || "USD",
          period: existingPledge.frequency,
          status: existingPledge.status,
        },
      });
    }

    const profile = normalizeSponsorProfile({ profile: incomingProfile, location });
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
      return res.status(400).json({ message: "Please provide valid sponsor and pledge details." });
    }

    const profileImage = req.body?.image;
    if (profileImage && !isValidCloudinaryImageReference(profileImage)) {
      return res.status(400).json({ message: "Sponsor image is invalid." });
    }

    const pledgeReference = `STRIPE-${new mongoose.Types.ObjectId().toString().toUpperCase()}`;
    let sponsor;
    let sponsorship;
    await session.withTransaction(async () => {
      const availableChild = await Childern.findOne({
        _id: childId,
        sponsorshipStatus: "Available",
      }).session(session);
      if (!availableChild) {
        const error = new Error("This child is no longer available for sponsorship.");
        error.statusCode = 409;
        throw error;
      }

      [sponsor] = await Sponsor.create(
        [{
          profile: { ...profile, email },
          sponsor: { name: profile.fullName, email, phone: profile.phone },
          image: profileImage
            ? { url: String(profileImage.url), public_id: String(profileImage.public_id) }
            : undefined,
          location: {
            address: String(location.address || "").trim(),
            country: String(location.country || "").trim(),
            city: String(location.city || "").trim(),
            state: String(location.state || "").trim(),
            region: String(location.region || "").trim(),
            zipCode: String(location.zipCode || "").trim(),
          },
          child: availableChild._id,
          donation: { amount, period, remindByEmail: donation.remindByEmail !== false },
          paymentMethod: "stripe",
          profileStatus: getProfileStatus(profile),
          source: "website",
        }],
        { session },
      );

      [sponsorship] = await Sponsorships.create(
        [{
          child: availableChild._id,
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
          notes: "Stripe Payment Link pledge; awaiting staff verification.",
        }],
        { session },
      );
    });

    return res.status(201).json({
      message: "Pledge saved. Payment must be verified by staff before sponsorship activation.",
      paymentUrl: paymentUrlForReference(pledgeReference),
      pledge: {
        id: sponsorship._id,
        reference: pledgeReference,
        amount,
        currency: "USD",
        period,
        status: sponsorship.status,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existingPledge = await Sponsorships.findOne({
        publicRequestId: String(req.body?.requestId || ""),
      });
      if (existingPledge) {
        return res.status(200).json({
          message: "This pledge has already been submitted.",
          paymentUrl: paymentUrlForReference(existingPledge.publicPledgeReference),
          pledge: {
            id: existingPledge._id,
            reference: existingPledge.publicPledgeReference,
            amount: existingPledge.amount,
            currency: existingPledge.currency || "USD",
            period: existingPledge.frequency,
            status: existingPledge.status,
          },
        });
      }
      return res.status(409).json({ message: "This pledge was already recorded." });
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to submit Stripe pledge.",
    });
  } finally {
    await session.endSession();
  }
};

exports.retryPublicAchInstructionEmail = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid pledge id." });
  }

  try {
    const delivery = await deliverAchInstructions(req.params.id);
    if (delivery.status === "unavailable") {
      return res.status(404).json({ message: "Pending public pledge not found." });
    }
    return res.status(200).json({ message: "Instruction email delivery checked.", emailDelivery: delivery });
  } catch {
    return res.status(500).json({ message: "Unable to retry instruction email delivery." });
  }
};

exports.getPendingPublicAchPledges = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const achSponsors = await Sponsor.find({ paymentMethod: "ach" }).distinct("_id");
    const filter = {
      status: "Pending",
      publicPledgeReference: { $exists: true, $ne: "" },
      donor: { $in: achSponsors },
    };
    const [pledges, total] = await Promise.all([
      Sponsorships.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate([{ path: "child" }, { path: "donor" }]),
      Sponsorships.countDocuments(filter),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    return res.status(200).json(pledges);
  } catch {
    return res.status(500).json({ message: "Unable to load pending ACH pledges." });
  }
};

exports.getPendingPublicStripePledges = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const stripeSponsors = await Sponsor.find({ paymentMethod: "stripe" }).distinct("_id");
    const filter = {
      status: "Pending",
      publicPledgeReference: { $exists: true, $ne: "" },
      donor: { $in: stripeSponsors },
    };
    const [pledges, total] = await Promise.all([
      Sponsorships.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate([{ path: "child" }, { path: "donor" }]),
      Sponsorships.countDocuments(filter),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    return res.status(200).json(pledges);
  } catch {
    return res.status(500).json({ message: "Unable to load pending Stripe pledges." });
  }
};

exports.confirmPublicStripePledge = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { amount, date, stripeReference, notes = "" } = req.body || {};
    const normalizedReference = String(stripeReference || "").trim();
    const receivedAmount = Number(amount);
    const receivedDate = date ? new Date(date) : new Date();
    if (
      !/^pi_[A-Za-z0-9]+$/.test(normalizedReference) ||
      !Number.isFinite(receivedAmount) ||
      receivedAmount <= 0 ||
      Number.isNaN(receivedDate.getTime())
    ) {
      return res.status(400).json({
        message: "A valid Stripe PaymentIntent ID, received amount, and payment date are required.",
      });
    }

    let updatedSponsorship;
    let isFullyFunded = false;
    await session.withTransaction(async () => {
      const sponsorship = await Sponsorships.findById(req.params.id).session(session);
      if (!sponsorship || !sponsorship.publicPledgeReference) {
        const error = new Error("Pending public Stripe pledge not found.");
        error.statusCode = 404;
        throw error;
      }
      if (sponsorship.status !== "Pending") {
        const error = new Error("This pledge is no longer pending.");
        error.statusCode = 409;
        throw error;
      }
      const donor = await Sponsor.findById(sponsorship.donor).session(session);
      if (!donor || donor.paymentMethod !== "stripe") {
        const error = new Error("This pledge is not a Stripe Payment Link pledge.");
        error.statusCode = 409;
        throw error;
      }
      const duplicatePayment = await Sponsorships.exists({
        "payments.transactionId": normalizedReference,
      }).session(session);
      if (duplicatePayment) {
        const error = new Error("That Stripe payment reference has already been recorded.");
        error.statusCode = 409;
        throw error;
      }

      const child = await Childern.findById(sponsorship.child).session(session);
      if (!child || (child.sponsorshipStatus !== "Available" && child.sponsor?.toString() !== donor._id.toString())) {
        const error = new Error("The child is no longer available; resolve the pledge conflict before confirming.");
        error.statusCode = 409;
        throw error;
      }

      sponsorship.payments.push({
        date: receivedDate,
        amount: receivedAmount,
        currency: "USD",
        method: "Stripe",
        transactionId: normalizedReference,
        notes: String(notes).trim(),
        recordedAt: new Date(),
        recordedBy: req.admin?.id,
        status: "Completed",
      });
      sponsorship.totalPaid = Number(sponsorship.totalPaid || 0) + receivedAmount;
      sponsorship.lastPayment = receivedDate;
      sponsorship.bankReference = normalizedReference;
      isFullyFunded = sponsorship.totalPaid >= Number(sponsorship.amount || 0);
      if (isFullyFunded) {
        sponsorship.status = "Active";
        sponsorship.startDate = sponsorship.startDate || receivedDate;
        child.sponsor = donor._id;
        child.sponsorshipStatus = "Sponsored";
        await child.save({ session });
      }
      await sponsorship.save({ session });
      updatedSponsorship = sponsorship;
    });

    return res.status(200).json({
      message: isFullyFunded
        ? "Stripe payment recorded and sponsorship activated."
        : "Stripe payment recorded. The pledge remains pending until fully funded.",
      sponsorship: updatedSponsorship,
      fullyFunded: isFullyFunded,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "That Stripe payment reference has already been recorded." });
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to confirm Stripe payment.",
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

      const donor = await Sponsor.findById(sponsorship.donor).session(session);
      if (!donor || donor.paymentMethod !== "ach") {
        const error = new Error("This pledge is not a manual ACH pledge.");
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

exports.createStripeCheckoutSession = async (req, res) => {
  if (!stripe) {
    return res.status(500).json({
      message: "Stripe is not configured on the server yet.",
    });
  }

  try {
    const { profile: incomingProfile, location = {}, donation, childId, requestId } =
      req.body || {};
    const amount = Number(donation?.amount ?? req.body?.amount ?? 0);
    const period = String(donation?.period || req.body?.period || "Monthly");
    const profile = normalizeSponsorProfile({ profile: incomingProfile, location });
    const email = String(profile.email || "").trim().toLowerCase();

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ message: "A valid child is required." });
    }

    if (!profile.fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !profile.phone) {
      return res.status(400).json({ message: "Please provide valid sponsor details." });
    }

    if (!Number.isFinite(amount) || amount < 5 || amount > 100000) {
      return res.status(400).json({ message: "Donation amount must be between $5 and $100,000." });
    }

    const validPeriods = ["Monthly", "3 Months", "6 Months", "Yearly"];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({ message: "Donation period is invalid." });
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

    const referenceId = String(requestId || new mongoose.Types.ObjectId().toString());
    const existingSponsorship = await Sponsorships.findOne({ publicRequestId: referenceId });
    if (existingSponsorship) {
      return res.status(200).json({
        message: "This sponsorship request has already been submitted.",
        sponsorshipId: existingSponsorship._id,
        status: existingSponsorship.status,
      });
    }

    const sponsor = await Sponsor.create({
      profile: { ...profile, email },
      sponsor: {
        name: profile.fullName,
        email,
        phone: profile.phone,
      },
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
        remindByEmail: donation?.remindByEmail !== false,
      },
      paymentMethod: "stripe",
      profileStatus: getProfileStatus(profile),
      source: "website",
    });

    const sponsorship = await Sponsorships.create({
      child: child._id,
      donor: sponsor._id,
      publicRequestId: referenceId,
      publicPledgeReference: `STRIPE-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
      startDate: new Date(),
      amount,
      currency: "USD",
      frequency: period,
      status: "Pending",
      payments: [],
      totalPaid: 0,
      notes: "Stripe Checkout session pending completion.",
    });

    const sessionData = buildStripeCheckoutSessionData({
      childId: child._id,
      childName: `${child.firstName || ""} ${child.secondName || ""}`.trim() || "child",
      sponsor: {
        name: profile.fullName,
        email,
        phone: profile.phone,
      },
      donation: {
        amount,
        period,
      },
      successUrl: `${process.env.WEBSITE_URL || "http://localhost:3000"}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.WEBSITE_URL || "http://localhost:3000"}/stripe/cancel`,
    });

    const checkoutSession = await stripe.checkout.sessions.create({
      ...sessionData,
      metadata: {
        ...sessionData.metadata,
        sponsorshipId: String(sponsorship._id),
        sponsorId: String(sponsor._id),
        childId: String(child._id),
        publicRequestId: referenceId,
      },
    });

    return res.status(200).json({
      success: true,
      sessionId: checkoutSession.id,
      url: checkoutSession.url,
      sponsorshipId: sponsorship._id,
      sponsorId: sponsor._id,
      amount,
      period,
    });
  } catch (error) {
    console.error("Stripe session creation failed:", error);
    return res.status(500).json({
      message: error.message || "Unable to create Stripe checkout session.",
    });
  }
};

exports.handleStripeWebhook = async (req, res) => {
  if (!stripe) {
    return res.status(500).send("Stripe is not configured on the server yet.");
  }

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET.");
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, event: event.type });
  }

  const transaction = await mongoose.startSession();
  try {
    const checkoutSession = event.data.object;
    const amount = Number((checkoutSession.amount_total || 0) / 100);
    const metadata = checkoutSession.metadata || {};
    const sponsorId = metadata.sponsorId;
    const childId = metadata.childId;
    const sponsorshipId = metadata.sponsorshipId;

    let processingResult = { ignored: true };
    await transaction.withTransaction(async () => {
      let sponsorship = null;
      if (mongoose.isValidObjectId(sponsorshipId)) {
        sponsorship = await Sponsorships.findById(sponsorshipId).session(transaction);
      }
      if (!sponsorship && metadata.publicRequestId) {
        sponsorship = await Sponsorships.findOne({
          publicRequestId: metadata.publicRequestId,
        }).session(transaction);
      }

      if (!sponsorship) {
        console.warn("Stripe webhook received for missing sponsorship:", metadata);
        processingResult = { ignored: true };
        return;
      }

      const validationError = getStripeSessionValidationError(
        checkoutSession,
        sponsorship,
      );
      if (validationError) {
        console.warn("Stripe webhook session rejected:", {
          sessionId: checkoutSession.id,
          sponsorshipId: sponsorship._id,
          reason: validationError,
        });
        processingResult = { ignored: true };
        return;
      }

      const paymentExists = sponsorship.payments.some(
        (payment) => payment.transactionId === checkoutSession.id,
      );
      if (paymentExists) {
        processingResult = { duplicated: true };
        return;
      }

      const paymentDate = new Date(
        checkoutSession.created ? checkoutSession.created * 1000 : Date.now(),
      );
      sponsorship.payments.push({
        date: paymentDate,
        amount,
        currency: checkoutSession.currency.toUpperCase(),
        method: "Stripe",
        transactionId: checkoutSession.id,
        paymentGroupId: checkoutSession.id,
        notes: `Stripe Checkout session completed (${checkoutSession.payment_status}).`,
        recordedAt: new Date(),
        status: "Completed",
      });

      sponsorship.status = "Active";
      sponsorship.totalPaid = Number(sponsorship.totalPaid || 0) + amount;
      sponsorship.lastPayment = paymentDate;
      sponsorship.startDate = sponsorship.startDate || paymentDate;
      sponsorship.bankReference = checkoutSession.id;
      await sponsorship.save({ session: transaction });

      const child = await Childern.findById(sponsorship.child).session(transaction);
      if (child) {
        child.sponsor = sponsorship.donor;
        child.sponsorshipStatus = "Sponsored";
        await child.save({ session: transaction });
      }

      const sponsor = await Sponsor.findById(sponsorship.donor).session(transaction);
      if (sponsor) {
        sponsor.paymentMethod = "stripe";
        sponsor.donation = {
          ...((sponsor.donation && typeof sponsor.donation === "object")
            ? sponsor.donation
            : {}),
          amount: sponsorship.amount,
          period: sponsorship.frequency,
        };
        await sponsor.save({ session: transaction });
      }

      processingResult = { sponsorship, sponsor };
    });

    if (processingResult.ignored) {
      return res.status(200).json({ received: true, ignored: true });
    }
    if (processingResult.duplicated) {
      return res.status(200).json({ received: true, duplicated: true });
    }

    const { sponsorship, sponsor } = processingResult;

    const admin = await Admin.findOne({ isActive: true }).sort({ createdAt: 1 });
    if (admin) {
      await Notification.create({
        userId: admin._id,
        type: "system",
        title: "Stripe sponsorship payment received",
        description: `A Stripe payment of ${formatMoney(amount)} was received for sponsorship ${sponsorship.publicPledgeReference || sponsorship._id}.`,
        linkTo: `/dashboard/sponsorships/${sponsorship._id}`,
        relatedEntityType: "sponsorship",
        relatedEntityId: String(sponsorship._id),
        status: "unread",
      });
    }

    const sponsorEmail =
      sponsor?.profile?.email ||
      sponsor?.sponsor?.email ||
      checkoutSession.customer_details?.email ||
      metadata.sponsorEmail;

    if (sponsorEmail) {
      await sendEmail({
        to: sponsorEmail,
        subject: "Thank you for your sponsorship donation",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 32px; color: #1f2937;">
            <h2>Thank you for your sponsorship!</h2>
            <p>Your Stripe payment of <strong>${formatMoney(amount)}</strong> has been received successfully.</p>
            <p>This sponsorship is now active and your support will go directly to the child you selected.</p>
            <p>With gratitude,<br />Seeds of Love Foundation</p>
          </div>
        `,
        text: `Thank you for your sponsorship donation of ${formatMoney(amount)}. Your payment has been received successfully and the sponsorship is now active.`,
      });
    }

    return res.status(200).json({
      received: true,
      sponsorshipId: sponsorship._id,
      amount,
      status: "completed",
    });
  } catch (error) {
    console.error("Failed to handle Stripe webhook:", error);
    return res.status(500).json({ message: "Unable to process Stripe webhook." });
  } finally {
    await transaction.endSession();
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
    const donationUpdate = pickEditableDonationFields(req.body.donation || {});

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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid sponsorship id." });
    }

    const paymentInput = normalizeManualPaymentInput(req.body);
    const sponsorship = await Sponsorships.findById(req.params.id);
    if (!sponsorship) {
      return res.status(404).json({ message: "Sponsorship record not found" });
    }
    if (sponsorship.publicPledgeReference) {
      return res.status(409).json({
        message: "Record public ACH receipts through the pledge confirmation workflow.",
      });
    }
    const duplicateReference = await Sponsorships.exists({
      "payments.transactionId": paymentInput.transactionId,
    });
    if (duplicateReference) {
      return res.status(409).json({ message: "That payment reference has already been recorded." });
    }

    const paymentDate = new Date();
    const newPayment = {
      date: paymentDate,
      amount: paymentInput.amount,
      method: paymentInput.method,
      transactionId: paymentInput.transactionId,
      notes: paymentInput.notes,
      status: "Completed",
    };
    const updatedSponsorship = await Sponsorships.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { publicPledgeReference: { $exists: false } },
          { publicPledgeReference: null },
          { publicPledgeReference: "" },
        ],
        "payments.transactionId": { $ne: paymentInput.transactionId },
      },
      {
        $push: { payments: newPayment },
        $inc: { totalPaid: paymentInput.amount },
        $set: { status: "Active", lastPayment: paymentDate },
      },
      { new: true, runValidators: true },
    );
    if (!updatedSponsorship) {
      const latestSponsorship = await Sponsorships.findById(req.params.id);
      if (!latestSponsorship) {
        return res.status(404).json({ message: "Sponsorship record not found" });
      }
      if (latestSponsorship.publicPledgeReference) {
        return res.status(409).json({
          message: "Record public ACH receipts through the pledge confirmation workflow.",
        });
      }
      return res.status(409).json({ message: "That payment reference has already been recorded." });
    }
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

    const normalizedSplit = normalizeSplitPaymentAllocationInput({
      amount,
      currency,
      allocationMode,
      allocations,
    });

    if (!MANUAL_PAYMENT_METHODS.includes(method)) {
      return res
        .status(400)
        .json({ message: "A valid manual payment method is required." });
    }

    const sponsor = await Sponsor.findById(sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });
    if (sponsor.isArchived) {
      return res
        .status(409)
        .json({ message: "Archived sponsors cannot receive payments." });
    }

    const sponsorshipIds = normalizedSplit.allocations.map(
      (allocation) => allocation.sponsorshipId,
    );
    const childIds = normalizedSplit.allocations.map((allocation) => allocation.childId);

    const sponsorships = await Sponsorships.find({
      _id: { $in: sponsorshipIds },
      donor: sponsorId,
    });

    if (sponsorships.length !== normalizedSplit.allocations.length) {
      return res.status(400).json({
        message: "One or more sponsorships do not belong to this sponsor.",
      });
    }

    const sponsorshipById = new Map(
      sponsorships.map((item) => [String(item._id), item]),
    );
    const normalizedAllocations = normalizedSplit.allocations.map((allocation) => {
      const sponsorship = sponsorshipById.get(allocation.sponsorshipId);

      if (
        !sponsorship ||
        String(sponsorship.child?._id || sponsorship.child) !== String(allocation.childId)
      ) {
        throw new Error("Each child must match its sponsorship record.");
      }
      if (!ACTIVE_SPONSORSHIP_STATUSES.includes(sponsorship.status)) {
        throw new Error(
          "Payments can only be recorded for active sponsorships.",
        );
      }

      return { sponsorship, amount: allocation.amount };
    });

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
