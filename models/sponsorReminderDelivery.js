const mongoose = require("mongoose");

const sponsorReminderDeliverySchema = new mongoose.Schema(
  {
    sponsorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsor",
      required: true,
    },
    dueDateKey: { type: String, required: true },
    dueDate: { type: Date, required: true },
    stage: {
      type: String,
      enum: ["7_days_before", "due_date", "first_overdue_day"],
      required: true,
    },
    sponsorshipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Sponsorships" }],
    recipient: { type: String, required: true, trim: true, lowercase: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true },
);

sponsorReminderDeliverySchema.index(
  { sponsorId: 1, dueDateKey: 1, stage: 1 },
  { unique: true },
);
sponsorReminderDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model(
  "SponsorReminderDelivery",
  sponsorReminderDeliverySchema,
);