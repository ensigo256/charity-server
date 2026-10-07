const mongoose = require("mongoose");

const stripePaymentLinkSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "organization-stripe-payment-link" },
    paymentLinkUrl: { type: String, required: true, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model(
  "StripePaymentLinkSettings",
  stripePaymentLinkSettingsSchema,
);