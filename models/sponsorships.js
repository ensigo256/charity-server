const mongoose = require("mongoose");

const sponsorshipsSchema = new mongoose.Schema(
  {
    child: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChildProfile",
      required: true,
    },
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sponsor",
      required: true,
    },
    publicPledgeReference: { type: String, trim: true },
    publicRequestId: { type: String, trim: true },
    achInstructionEmail: {
      status: {
        type: String,
        enum: ["pending", "sending", "sent", "failed"],
        default: undefined,
      },
      attempts: { type: Number, default: 0 },
      lastAttemptAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      lastError: { type: String, trim: true, default: "" },
    },
    bankReference: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    amount: { type: Number, required: true },
    currency: { type: String, trim: true, default: "USD" },
    frequency: {
      type: String,
      enum: ["Monthly", "3 Months", "6 Months", "Yearly"],
      default: "Monthly",
    },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled", "Pending"],
      default: "Pending",
    },
    payments: [
      {
        date: { type: Date, required: true },
        amount: { type: Number, required: true },
        currency: { type: String, default: "UGX", trim: true },
        method: {
          type: String,
          enum: [
            "Cash",
            "Bank Transfer",
            "Mobile Money",
            "ACH",
            "PayPal",
            "Zelle",
            "Stripe",
            "Check",
            "Other",
          ],
          required: true,
        },
        transactionId: { type: String, required: true },
        paymentGroupId: { type: String, default: null, index: true },
        notes: { type: String, trim: true },
        recordedAt: { type: Date, default: Date.now },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        status: {
          type: String,
          enum: ["Completed", "Failed", "Pending"],
          default: "Pending",
        },
      },
    ],
    lastPayment: { type: Date },
    expectedFundsDate: { type: Date, default: null },
    totalPaid: { type: Number, default: 0 },
    notes: { type: String, trim: true },
  },

  { timestamps: true },
);
sponsorshipsSchema.index({ createdAt: -1, _id: -1 });
sponsorshipsSchema.index({ donor: 1, createdAt: -1, _id: -1 });
sponsorshipsSchema.index({ child: 1, createdAt: -1, _id: -1 });
sponsorshipsSchema.index({ status: 1, createdAt: -1, _id: -1 });
sponsorshipsSchema.index({ publicPledgeReference: 1 }, { unique: true, sparse: true });
sponsorshipsSchema.index({ publicRequestId: 1 }, { unique: true, sparse: true });
sponsorshipsSchema.index({ bankReference: 1 }, { unique: true, sparse: true });
const Sponsorships = mongoose.model("Sponsorships", sponsorshipsSchema);

module.exports = Sponsorships;
