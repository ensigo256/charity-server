const mongoose = require("mongoose");

const subscribersSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ["pending", "active", "unsubscribed"], default: "pending" },
    verified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpiresAt: { type: Date },
    unsubscribeToken: { type: String },
    unsubscribed: { type: Boolean, default: false },
    unsubscribedAt: { type: Date },
    subscribedOn: { type: Date, default: Date.now },
    lastEmailSentAt: { type: Date },
  },

  { timestamps: true },
);

subscribersSchema.index({ verificationToken: 1 }, { sparse: true });
subscribersSchema.index({ unsubscribeToken: 1 }, { sparse: true });
subscribersSchema.index({ subscribedOn: -1 });
subscribersSchema.index({ status: 1, subscribedOn: -1, _id: -1 });

const Subscriber = mongoose.model("Subscriber", subscribersSchema);

module.exports = Subscriber;
