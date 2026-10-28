const crypto = require("node:crypto");
const StripePaymentPageToken = require("../models/stripePaymentPageToken");
const StripePaymentAttempt = require("../models/stripePaymentAttempt");
const { getConfiguredPaymentLink } = require("../controllers/stripePaymentLinkSettingsController");
const {
  getExpectedStripeAmount,
  getRemainingStripeAmount,
} = require("./stripePaymentAttempt");
const { calculateNextPaymentDate } = require("./notificationUtil");

const TOKEN_TTL_DAYS = 90;

function hashPaymentPageToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function getCurrentDueDateKey(sponsorship) {
  const completedPaymentDates = (sponsorship.payments || [])
    .filter((payment) => payment.status === "Completed" && payment.date)
    .map((payment) => new Date(payment.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right - left);
  const lastPaymentDate =
    completedPaymentDates[0] || sponsorship.lastPayment || sponsorship.startDate;
  const dueDate = calculateNextPaymentDate({
    lastPaymentDate,
    paymentPeriod: sponsorship.frequency || "Monthly",
    startDate: sponsorship.startDate,
    expectedFundsDate: sponsorship.expectedFundsDate,
  });
  return dueDate.toISOString().slice(0, 10);
}

function getWebsiteOrigin() {
  const configured = String(process.env.WEBSITE_URL || "https://www.seedsoflovefoundation.org").trim();
  const url = new URL(configured);
  const isLocalHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password) {
    throw new Error("WEBSITE_URL must be HTTPS, except for local development.");
  }
  return url.origin;
}

async function createPaymentPageToken({
  sponsorshipId,
  dueDate,
  dueDateKey,
  expectedAmount,
}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const tokenRecord = await StripePaymentPageToken.create({
    tokenHash: hashPaymentPageToken(token),
    sponsorship: sponsorshipId,
    dueDateKey: String(dueDateKey),
    dueDate: new Date(dueDate),
    expectedAmount: Number(expectedAmount),
    expiresAt,
  });
  const path = `/pay/${token}`;
  return {
    tokenRecord,
    path,
    url: `${getWebsiteOrigin()}${path}`,
  };
}

async function getValidPaymentPageToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return null;
  }
  const tokenRecord = await StripePaymentPageToken.findOne({
    tokenHash: hashPaymentPageToken(token),
    status: "active",
    expiresAt: { $gt: new Date() },
  })
    .populate({
      path: "sponsorship",
      populate: [{ path: "donor" }, { path: "child" }],
    });

  if (
    !tokenRecord?.sponsorship ||
    (tokenRecord.sponsorship.paymentMethod ||
      tokenRecord.sponsorship.donor?.paymentMethod) !== "stripe" ||
    !["Active", "Pending"].includes(tokenRecord.sponsorship.status)
  ) {
    return null;
  }
  const sponsorship = tokenRecord.sponsorship;
  if (tokenRecord.dueDateKey === "initial" && sponsorship.status === "Active") {
    return null;
  }
  if (
    sponsorship.status === "Active" &&
    tokenRecord.dueDateKey !== getCurrentDueDateKey(sponsorship)
  ) {
    return null;
  }
  if (
    sponsorship.status === "Pending" &&
    Number(sponsorship.totalPaid || 0) >= Number(sponsorship.amount || 0)
  ) {
    return null;
  }
  if (
    await StripePaymentAttempt.exists({
      sponsorship: sponsorship._id,
      dueDateKey: tokenRecord.dueDateKey,
      status: "needs_management_review",
    })
  ) {
    return null;
  }
  if ((await getExpectedAmountForPage(tokenRecord)) <= 0) {
    return null;
  }
  return tokenRecord;
}

async function getExpectedAmountForPage(tokenRecord) {
  const sponsorship = tokenRecord.sponsorship;
  const baseAmount = getExpectedStripeAmount(
    sponsorship,
    tokenRecord.expectedAmount,
  );
  if (sponsorship.status === "Pending" || tokenRecord.dueDateKey === "initial") {
    return baseAmount;
  }

  const approvedAttempts = await StripePaymentAttempt.find({
    sponsorship: sponsorship._id,
    dueDateKey: tokenRecord.dueDateKey,
    status: "approved",
  }).select("actualAmount");
  return getRemainingStripeAmount(
    baseAmount,
    approvedAttempts.map((attempt) => Number(attempt.actualAmount || 0)),
  );
}

async function getAttemptCheckoutUrl(publicReference) {
  const paymentLink = await getConfiguredPaymentLink();
  if (!paymentLink.configured) {
    const error = new Error("Stripe Payment Link is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL(paymentLink.paymentLinkUrl);
  url.searchParams.set("client_reference_id", publicReference);
  return url.toString();
}

module.exports = {
  TOKEN_TTL_DAYS,
  createPaymentPageToken,
  getCurrentDueDateKey,
  getAttemptCheckoutUrl,
  getExpectedAmountForPage,
  getValidPaymentPageToken,
  getWebsiteOrigin,
  hashPaymentPageToken,
};
