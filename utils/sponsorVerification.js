const crypto = require("node:crypto");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENT_SPONSORSHIP_STATUSES = ["Active", "Pending"];
const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RESENDS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  return raw.replace(/\D/g, "");
}

function hashVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createVerificationToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashVerificationToken(token) };
}

function currentPairKey(childId, sponsorId) {
  return `${childId}:${sponsorId}`;
}

function verificationExpiry(now = new Date()) {
  return new Date(now.getTime() + VERIFICATION_LIFETIME_MS);
}

function requestPurgeDate(now = new Date()) {
  return new Date(now.getTime() + VERIFICATION_LIFETIME_MS + REQUEST_RETENTION_MS);
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(email);
}

module.exports = {
  CURRENT_SPONSORSHIP_STATUSES,
  MAX_RESENDS,
  REQUEST_RETENTION_MS,
  RESEND_COOLDOWN_MS,
  createVerificationToken,
  currentPairKey,
  hashVerificationToken,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  requestPurgeDate,
  verificationExpiry,
};
