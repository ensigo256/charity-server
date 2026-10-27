const mongoose = require("mongoose");

const stripePaymentAttemptSchema = new mongoose.Schema(
  {
    pageToken: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StripePaymentPageToken",
      required: true,
      index: true,
    },
    sponsorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsorships",
      required: true,
      index: true,
    },
    sponsor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsor",
      required: true,
      index: true,
    },
    publicReference: { type: String, required: true, unique: true, trim: true },
    expectedAmount: { type: Number, required: true, min: 0.01 },
    dueDate: { type: Date, required: true },
    dueDateKey: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: [
        "awaiting_verification",
        "approved",
        "expired",
        "rejected",
        "needs_management_review",
      ],
      default: "awaiting_verification",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    actualAmount: { type: Number, min: 0 },
    stripeReference: { type: String, trim: true },
    paymentDate: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    verifiedAt: { type: Date },
    resolutionNotes: { type: String, trim: true, default: "" },
    adminEmailSentAt: { type: Date, default: null },
    adminEmailError: { type: String, trim: true, default: "" },
    inAppNotifiedAt: { type: Date, default: null },
    inAppNotificationError: { type: String, trim: true, default: "" },
  },
  { timestamps: true, versionKey: false },
);

stripePaymentAttemptSchema.index(
  { sponsorship: 1, dueDateKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "awaiting_verification" },
  },
);
stripePaymentAttemptSchema.index(
  { stripeReference: 1 },
  { unique: true, sparse: true },
);
stripePaymentAttemptSchema.index({ status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model(
  "StripePaymentAttempt",
  stripePaymentAttemptSchema,
);
