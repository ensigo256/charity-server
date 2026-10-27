const StripePaymentLinkSettings = require("../models/stripePaymentLinkSettings");

const SETTINGS_ID = "organization-stripe-payment-link";
const ALLOWED_HOSTS = new Set(["buy.stripe.com", "donate.stripe.com"]);
const DEFAULT_ADMIN_ALERT_EMAIL = "info@ensigooflove.org";

function validateAdminAlertEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    const error = new Error("Enter a valid payment-attempt notification email.");
    error.statusCode = 400;
    throw error;
  }
  return email;
}

function validatePaymentLinkUrl(value) {
  const normalized = String(value || "").trim();
  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    const error = new Error("Enter a valid Stripe Payment Link URL.");
    error.statusCode = 400;
    throw error;
  }

  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.pathname.length < 2 ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    const error = new Error("Use an HTTPS Payment Link hosted by buy.stripe.com or donate.stripe.com.");
    error.statusCode = 400;
    throw error;
  }

  return parsed.toString();
}

async function getConfiguredPaymentLink() {
  const record = await StripePaymentLinkSettings.findById(SETTINGS_ID).lean();
  const storedUrl = record?.paymentLinkUrl;
  const fallbackUrl = String(process.env.STRIPE_PAYMENT_LINK_URL || "").trim();
  const paymentLinkUrl = storedUrl || fallbackUrl;

  if (!paymentLinkUrl) return { configured: false, paymentLinkUrl: "", source: "none" };

  try {
    return {
      configured: true,
      paymentLinkUrl: validatePaymentLinkUrl(paymentLinkUrl),
      source: storedUrl ? "dashboard" : "environment",
    };
  } catch {
    return { configured: false, paymentLinkUrl: "", source: "invalid" };
  }
}

exports.getConfiguredPaymentLink = getConfiguredPaymentLink;
exports.validatePaymentLinkUrl = validatePaymentLinkUrl;

exports.getAdminStripePaymentLink = async (_req, res) => {
  try {
    const result = await getConfiguredPaymentLink();
    const settings = await StripePaymentLinkSettings.findById(SETTINGS_ID).lean();
    return res.status(200).json({
      ...result,
      adminAlertEmail: settings?.adminAlertEmail || DEFAULT_ADMIN_ALERT_EMAIL,
    });
  } catch {
    return res.status(500).json({ message: "Unable to load Stripe Payment Link settings." });
  }
};

exports.getPublicStripePaymentLink = async (_req, res) => {
  try {
    const { configured, paymentLinkUrl } = await getConfiguredPaymentLink();
    return res.status(200).json({ configured, paymentUrl: paymentLinkUrl });
  } catch {
    return res.status(500).json({ message: "Unable to load donation payment options." });
  }
};

exports.updateStripePaymentLink = async (req, res) => {
  try {
    const paymentLinkUrl = validatePaymentLinkUrl(req.body?.paymentLinkUrl);
    const adminAlertEmail = validateAdminAlertEmail(
      req.body?.adminAlertEmail || DEFAULT_ADMIN_ALERT_EMAIL,
    );
    await StripePaymentLinkSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { $set: { paymentLinkUrl, adminAlertEmail, updatedBy: req.admin?.id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return res.status(200).json({
      message: "Stripe Payment Link saved.",
      configured: true,
      paymentLinkUrl,
      adminAlertEmail,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to save Stripe Payment Link.",
    });
  }
};

exports.validateAdminAlertEmail = validateAdminAlertEmail;
exports.DEFAULT_ADMIN_ALERT_EMAIL = DEFAULT_ADMIN_ALERT_EMAIL;