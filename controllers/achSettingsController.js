const AchSettings = require("../models/achSettings");
const { decryptAchSettings, encryptAchSettings } = require("../utils/achSettingsCrypto");

const SETTINGS_ID = "organization-ach";
const DEFAULT_SPONSOR_MESSAGE =
  "Thank you for your support and kindness. Please contact {recipientEmail} to begin the payment process.";

function publicSettings(settings) {
  return {
    configured: Boolean(settings),
    recipientEmail: settings?.recipientEmail || "",
    sponsorMessage: settings?.sponsorMessage || DEFAULT_SPONSOR_MESSAGE,
  };
}

function validateSettings(settings) {
  const normalized = {
    recipientEmail: String(settings.recipientEmail || "").trim().toLowerCase(),
    sponsorMessage: String(settings.sponsorMessage || "").trim() || DEFAULT_SPONSOR_MESSAGE,
  };

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.recipientEmail) ||
    normalized.sponsorMessage.length > 4000
  ) {
    const error = new Error("Please provide a valid ACH recipient email and sponsor message.");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function readStoredSettings() {
  const record = await AchSettings.findById(SETTINGS_ID).select("+encryptedValue");
  return record ? decryptAchSettings(record.encryptedValue) : null;
}

exports.getAchSettings = async (_req, res) => {
  try {
    return res.status(200).json(publicSettings(await readStoredSettings()));
  } catch {
    return res.status(500).json({ message: "Unable to load ACH settings." });
  }
};

exports.updateAchSettings = async (req, res) => {
  try {
    const existing = await readStoredSettings();
    const incoming = req.body || {};
    const merged = { ...(existing || {}) };
    for (const field of ["recipientEmail", "sponsorMessage"]) {
      if (incoming[field] !== undefined) merged[field] = incoming[field];
    }
    const settings = validateSettings(merged);
    const encryptedValue = encryptAchSettings(settings);
    await AchSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { $set: { encryptedValue, updatedBy: req.admin?.id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return res.status(200).json({
      message: "ACH transfer settings saved.",
      settings: publicSettings(settings),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to save ACH settings.",
    });
  }
};

exports.readStoredSettings = readStoredSettings;
exports.publicSettings = publicSettings;
exports.validateSettings = validateSettings;