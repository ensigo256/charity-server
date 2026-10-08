const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, required: true, trim: true, maxlength: 120 },
    review: { type: String, required: true, trim: true, maxlength: 3000 },
    photo: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
  },
  { timestamps: true },
);

reviewSchema.index({ status:  1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("Review", reviewSchema);