const mongoose = require("mongoose");

const sponsorVerificationRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, trim: true },
    tokenHash: { type: String, unique: true, sparse: true, select: false },
    status: {
      type: String,
      enum: ["pending", "verified", "identity_review", "duplicate", "expired"],
      default: "pending",
      index: true,
    },
    profile: {
      fullName: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true, index: true },
      phone: { type: String, required: true, trim: true },
      country: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      region: { type: String, trim: true, default: "" },
      zipCode: { type: String, trim: true, default: "" },
      bio: { type: String, trim: true, default: "" },
    },
    location: {
      address: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      region: { type: String, trim: true, default: "" },
      zipCode: { type: String, trim: true, default: "" },
    },
    image: {
      url: { type: String, trim: true, default: "" },
      public_id: { type: String, trim: true, default: "" },
    },
    donation: {
      amount: { type: Number, required: true },
      period: {
        type: String,
        enum: ["Monthly", "3 Months", "6 Months", "Yearly"],
        required: true,
      },
      remindByEmail: { type: Boolean, default: true },
    },
    child: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChildProfile",
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["ach", "stripe"],
      required: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    purgeAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    sponsor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsor",
      default: null,
    },
    sponsorship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsorships",
      default: null,
    },
    continuationPath: { type: String, trim: true, default: "" },
    resendCount: { type: Number, default: 0 },
    emailDeliveryStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    lastSentAt: { type: Date, default: Date.now },
    lastAdminDigestAt: { type: Date, default: null },
    identityReviewReason: { type: String, trim: true, default: "" },
    adminFollowUp: { type: String, trim: true, default: "" },
    followUpHistory: [
      {
        note: { type: String, required: true, trim: true, maxlength: 1000 },
        admin: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

sponsorVerificationRequestSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
sponsorVerificationRequestSchema.index({ status: 1, expiresAt: 1, createdAt: -1 });

module.exports = mongoose.model(
  "SponsorVerificationRequest",
  sponsorVerificationRequestSchema,
);
