const mongoose = require("mongoose");

const achSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "organization-ach" },
    encryptedValue: { type: String, required: true, select: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("AchSettings", achSettingsSchema);