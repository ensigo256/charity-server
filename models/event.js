const mongoose = require("mongoose");

const eventsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    topic: { type: String, required: true, trim: true, maxlength: 160 },
    date: { type: String, required: true },
    time: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    category: {
      type: String,
      required: true,
      enum: ["Community", "Education", "Volunteer", "General"],
    },
    image: { url: String, public_id: String },

    location: { type: String, required: true, trim: true, maxlength: 200 },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    status: { type: String, enum: ["upcoming", "past"], default: "upcoming" },

    shares: [{ type: String }],
  },
  { timestamps: true },
);
eventsSchema.index({ createdAt: -1, _id: -1 });
eventsSchema.index({ status: 1, createdAt: -1, _id: -1 });
const Events = mongoose.model("Event", eventsSchema);

module.exports = Events;
