const { add } = require("date-fns");
const mongoose = require("mongoose");

const sponsorsSchema = new mongoose.Schema(
  {
    profile: {
      fullName: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      country: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      region: { type: String, trim: true, default: "" },
      phone: { type: String, required: true, trim: true },
      zipCode: { type: String, trim: true, default: "" },
      bio: { type: String, trim: true, default: "" },
    },
    sponsor: {
      email: { type: String, trim: true },
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
    },
    image: {
      url: { type: String, default: "", trim: true },
      public_id: { type: String, default: "", trim: true },
    },
    child: { type: mongoose.Schema.Types.ObjectId, ref: "ChildProfile" },
    location: {
      address: { type: String, trim: true },
      country: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      region: { type: String, trim: true },
      zipCode: { type: String, trim: true },
      bio: { type: String, trim: true },
    },
    donation: {
      amount: { type: Number, required: true },
      period: {
        type: String,
        enum: ["Monthly", "3 Months", "6 Months", "Yearly"],
        required: true,
      },
      expectedFundsDate: { type: Date, default: null },
      remindByEmail: { type: Boolean, default: true },
    },
    paymentMethod: {
      type: String,
      enum: ["zelle", "stripe", "check", "card", "paypal", "ach"],
      required: true,
    },
    profileStatus: {
      type: String,
      enum: ["Incomplete", "Complete"],
      default: "Incomplete",
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    reminderPreferenceInitializedAt: {
      type: Date,
      default: null,
      select: false,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      enum: ["website", "dashboard"],
      default: "website",
    },
  },

  { timestamps: true },
);
sponsorsSchema.index({ isArchived: 1, createdAt: -1, _id: -1 });
sponsorsSchema.index({ child: 1, createdAt: -1, _id: -1 });
const Sponsor = mongoose.model("Sponsor", sponsorsSchema);

module.exports = Sponsor;
