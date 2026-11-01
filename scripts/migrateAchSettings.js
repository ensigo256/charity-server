require("dotenv").config();
const mongoose = require("mongoose");
const AchSettings = require("../models/achSettings");
const { decryptAchSettings, encryptAchSettings } = require("../utils/achSettingsCrypto");

const DEFAULT_SPONSOR_MESSAGE =
  "Thank you for your support and kindness. Please contact {recipientEmail} to begin the payment process.";

async function main() {
  const recipientEmail = String(process.env.ACH_RECIPIENT_EMAIL || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error("Set ACH_RECIPIENT_EMAIL to the staff inbox that receives ACH configurations.");
  }

  await mongoose.connect(process.env.DB_URL);
  const record = await AchSettings.findById("organization-ach").select("+encryptedValue");
  if (!record) {
    await AchSettings.findByIdAndUpdate(
      "organization-ach",
      {
        $set: {
          encryptedValue: encryptAchSettings({
            recipientEmail,
            sponsorMessage: String(process.env.ACH_SPONSOR_MESSAGE || "").trim() || DEFAULT_SPONSOR_MESSAGE,
          }),
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    console.log("Created ACH contact settings.");
    return;
  }

  decryptAchSettings(record.encryptedValue);
  await AchSettings.findByIdAndUpdate("organization-ach", {
    $set: {
      encryptedValue: encryptAchSettings({
        recipientEmail,
        sponsorMessage: String(process.env.ACH_SPONSOR_MESSAGE || "").trim() || DEFAULT_SPONSOR_MESSAGE,
      }),
    },
  });
  console.log("Migrated ACH settings. Legacy bank credential values were removed.");
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
