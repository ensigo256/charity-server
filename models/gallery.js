const mongoose = require("mongoose");

const gallerySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: {
      type: String,
      required: true,
      enum: ["Events", "Education", "Volunteers", "General"],
    },
    featured: { type: Boolean, default: false },
    image: { url: String, public_id: String, size: String },
  },

  { timestamps: true },
);
gallerySchema.index({ createdAt: -1, _id: -1 });
gallerySchema.index({ category: 1, featured: 1, createdAt: -1, _id: -1 });
const Gallery = mongoose.model("Gallery", gallerySchema);

module.exports = Gallery;
