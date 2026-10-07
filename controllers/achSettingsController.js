const AchSettings = require("../models/achSettings");
const { decryptAchSettings, encryptAchSettings } = require("../utils/achSettingsCrypto");

const SETTINGS_ID = "organization-ach";
const SECRET_FIELDS = ["routingNumber", "accountNumber"];

function publicSettings(settings) {
  return {
    configured: Boolean(settings),
    beneficiaryName: settings?.beneficiaryName || "",
    bankName: settings?.bankName || "",
    accountType: settings?.accountType || "",
    referenceInstructions: settings?.referenceInstructions || "",
    routingNumberMasked: settings?.routingNumber
      ? `Ending in ${settings.routingNumber.slice(-4)}`
      : "",
    accountNumberLast4: settings?.accountNumber?.slice(-4) || "",
  };
}

function validateSettings(settings) {
  const normalized = {
    beneficiaryName: String(settings.beneficiaryName || "").trim(),
    bankName: String(settings.bankName || "").trim(),
    routingNumber: String(settings.routingNumber || "").trim(),
    accountNumber: String(settings.accountNumber || "").trim(),
    accountType: String(settings.accountType || "").trim().toLowerCase(),
    referenceInstructions: String(settings.referenceInstructions || "").trim(),
  };

  if (
    normalized.beneficiaryName.length < 2 || normalized.beneficiaryName.length > 120 ||
    normalized.bankName.length < 2 || normalized.bankName.length > 120 ||
    !/^\d{9}$/.test(normalized.routingNumber) ||
    !/^\d{4,17}$/.test(normalized.accountNumber) ||
    !["checking", "savings"].includes(normalized.accountType) ||
    normalized.referenceInstructions.length < 5 || normalized.referenceInstructions.length > 2000
  ) {
    const error = new Error("Please provide valid ACH beneficiary, bank, account, and transfer instruction details.");
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
    for (const field of ["beneficiaryName", "bankName", "accountType", "referenceInstructions"]) {
      if (incoming[field] !== undefined) merged[field] = incoming[field];
    }
    for (const field of SECRET_FIELDS) {
      if (incoming[field] !== undefined && String(incoming[field]).trim()) {
        merged[field] = incoming[field];
      }
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