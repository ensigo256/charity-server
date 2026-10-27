const mongoose = require("mongoose");

const stripePaymentPageTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    sponsorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsorships",
      required: true,
      index: true,
    },
    dueDateKey: { type: String, required: true, trim: true },
    dueDate: { type: Date, required: true },
    expectedAmount: { type: Number, required: true, min: 0.01 },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "revoked", "expired"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
);

stripePaymentPageTokenSchema.index({ sponsorship: 1, dueDateKey: 1, createdAt: -1 });
stripePaymentPageTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model(
  "StripePaymentPageToken",
  stripePaymentPageTokenSchema,
);
