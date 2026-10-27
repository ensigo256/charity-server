const mongoose = require("mongoose");

const achReceiptReferenceSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, trim: true, unique: true },
    sponsorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsorships",
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("AchReceiptReference", achReceiptReferenceSchema);
