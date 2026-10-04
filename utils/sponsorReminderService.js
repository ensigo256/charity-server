const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const SponsorReminderDelivery = require("../models/sponsorReminderDelivery");
const {
  calculateNextPaymentDate,
  getSponsorEmailReminderStage,
} = require("./notificationUtil");
const { sendSponsorReminderEmail } = require("./mail");

const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 15 * 60 * 1000;
const SENDING_LEASE_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function getLatestCompletedPayment(sponsorship) {
  const completedPayments = (sponsorship.payments || [])
    .filter((payment) => payment.status === "Completed" && payment.date)
    .map((payment) => new Date(payment.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right - left);

  return completedPayments[0] || sponsorship.lastPayment || sponsorship.startDate;
}

function getSponsorEmail(sponsor) {
  return String(sponsor?.profile?.email || sponsor?.sponsor?.email || "")
    .trim()
    .toLowerCase();
}

function isSponsorReminderEnabled(sponsor) {
  return sponsor?.donation?.remindByEmail !== false;
}

function buildDeliveryCandidate(sponsorship, referenceDate) {
  const sponsor = sponsorship.donor;
  if (!sponsor?._id || sponsor.isArchived || !isSponsorReminderEnabled(sponsor)) {
    return null;
  }

  const email = getSponsorEmail(sponsor);
  if (!EMAIL_PATTERN.test(email)) return null;

  const lastPaymentDate = getLatestCompletedPayment(sponsorship);
  if (!lastPaymentDate) return null;

  const dueDate = calculateNextPaymentDate({
    lastPaymentDate,
    paymentPeriod: sponsorship.frequency || sponsor.donation?.period || "Monthly",
    startDate: sponsorship.startDate,
    expectedFundsDate:
      sponsorship.expectedFundsDate || sponsor.donation?.expectedFundsDate,
  });
  const stage = getSponsorEmailReminderStage({
    nextPaymentDate: dueDate,
    referenceDate,
  });
  if (!stage) return null;

  const childName = sponsorship.child
    ? [sponsorship.child.givenName || sponsorship.child.firstName, sponsorship.child.secondName]
        .filter(Boolean)
        .join(" ")
    : "Sponsored child";
  const payload = {
    name: sponsor.profile?.fullName || sponsor.sponsor?.name || "Sponsor",
    dueDate: dueDate.toISOString(),
    stage,
    sponsorships: [{
      amount: sponsorship.amount ?? sponsor.donation?.amount ?? 0,
      currency: sponsorship.currency || "USD",
      frequency: sponsorship.frequency || sponsor.donation?.period || "Monthly",
      children: [childName],
    }],
  };

  return {
    sponsorId: sponsor._id,
    dueDateKey: dateKey(dueDate),
    dueDate,
    stage,
    sponsorshipId: sponsorship._id,
    email,
    payload,
  };
}

function mergeCandidate(grouped, candidate) {
  const key = `${String(candidate.sponsorId)}:${candidate.dueDateKey}:${candidate.stage}`;
  const existing = grouped.get(key);
  if (existing) {
    existing.sponsorshipIds.push(candidate.sponsorshipId);
    existing.payload.sponsorships.push(...candidate.payload.sponsorships);
    return;
  }

  grouped.set(key, {
    sponsorId: candidate.sponsorId,
    dueDateKey: candidate.dueDateKey,
    dueDate: candidate.dueDate,
    stage: candidate.stage,
    sponsorshipIds: [candidate.sponsorshipId],
    recipient: candidate.email,
    payload: candidate.payload,
  });
}

async function queueCandidates(candidates) {
  const queued = [];
  for (const candidate of candidates.values()) {
    const identity = {
      sponsorId: candidate.sponsorId,
      dueDateKey: candidate.dueDateKey,
      stage: candidate.stage,
    };
    try {
      let delivery = await SponsorReminderDelivery.findOneAndUpdate(
        { ...identity, status: { $in: ["queued", "failed"] } },
        {
          $set: {
            sponsorshipIds: candidate.sponsorshipIds,
            recipient: candidate.recipient,
            payload: candidate.payload,
            dueDate: candidate.dueDate,
          },
        },
        { new: true },
      );

      if (!delivery) {
        delivery = await SponsorReminderDelivery.create({
          ...candidate,
          status: "queued",
          attempts: 0,
          nextAttemptAt: new Date(0),
        });
      }
      if (delivery) queued.push(delivery);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await SponsorReminderDelivery.findOneAndUpdate(
        { ...identity, status: { $in: ["queued", "failed"] } },
        {
          $set: {
            sponsorshipIds: candidate.sponsorshipIds,
            recipient: candidate.recipient,
            payload: candidate.payload,
            dueDate: candidate.dueDate,
          },
        },
        { new: true },
      );
      if (existing) queued.push(existing);
    }
  }
  return queued;
}

async function claimDelivery(deliveryId, now) {
  return SponsorReminderDelivery.findOneAndUpdate(
    {
      _id: deliveryId,
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [
        { status: { $in: ["queued", "failed"] }, nextAttemptAt: { $lte: now } },
        { status: "sending", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: "sending", leaseUntil: new Date(now.getTime() + SENDING_LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { new: true },
  );
}

async function deliveryIsStillValid(delivery, referenceDate) {
  const sponsor = await Sponsor.findById(delivery.sponsorId).lean();
  if (!sponsor || sponsor.isArchived || !isSponsorReminderEnabled(sponsor)) return false;
  if (getSponsorEmail(sponsor) !== delivery.recipient) return false;

  const sponsorships = await Sponsorships.find({
    _id: { $in: delivery.sponsorshipIds },
    donor: delivery.sponsorId,
    status: "Active",
  }).populate("child");
  if (!sponsorships.length) return false;

  const currentCandidates = new Map();
  for (const sponsorship of sponsorships) {
    const candidate = buildDeliveryCandidate(sponsorship, referenceDate);
    if (candidate && candidate.dueDateKey === delivery.dueDateKey && candidate.stage === delivery.stage) {
      mergeCandidate(currentCandidates, candidate);
    }
  }
  const current = [...currentCandidates.values()][0];
  if (!current) return false;

  delivery.payload = current.payload;
  await delivery.save();
  return true;
}

async function deliverQueuedCandidates(candidates, referenceDate, sendEmail = sendSponsorReminderEmail) {
  const deliveries = await queueCandidates(candidates);
  let sent = 0;

  for (const delivery of deliveries) {
    if (delivery.status === "sent" || delivery.status === "cancelled") continue;
    const claimed = await claimDelivery(delivery._id, referenceDate);
    if (!claimed) continue;

    try {
      const stillValid = await deliveryIsStillValid(claimed, referenceDate);
      if (!stillValid) {
        await SponsorReminderDelivery.findByIdAndUpdate(claimed._id, {
          $set: { status: "cancelled", leaseUntil: null },
        });
        continue;
      }

      await sendEmail({ email: claimed.recipient, ...claimed.payload });
      await SponsorReminderDelivery.findByIdAndUpdate(claimed._id, {
        $set: { status: "sent", sentAt: new Date(), leaseUntil: null, lastError: "" },
      });
      sent += 1;
    } catch (error) {
      const retryDelay = RETRY_BASE_DELAY_MS * 2 ** Math.max(claimed.attempts - 1, 0);
      await SponsorReminderDelivery.findByIdAndUpdate(claimed._id, {
        $set: {
          status: "failed",
          leaseUntil: null,
          nextAttemptAt: new Date(referenceDate.getTime() + retryDelay),
          lastError: String(error.message || error).slice(0, 1000),
        },
      });
      console.error("Sponsor reminder email failed:", error.message);
    }
  }

  return { queued: deliveries.length, sent };
}

async function processSponsorReminderEmails({ referenceDate = new Date(), sendEmail } = {}) {
  const sponsorships = await Sponsorships.find({ status: "Active" })
    .populate("donor")
    .populate("child");
  const candidates = new Map();

  for (const sponsorship of sponsorships) {
    const candidate = buildDeliveryCandidate(sponsorship, referenceDate);
    if (candidate) mergeCandidate(candidates, candidate);
  }

  return deliverQueuedCandidates(candidates, referenceDate, sendEmail);
}

module.exports = {
  buildDeliveryCandidate,
  dateKey,
  getSponsorEmail,
  isSponsorReminderEnabled,
  processSponsorReminderEmails,
};