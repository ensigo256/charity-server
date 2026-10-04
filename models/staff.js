const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true },
        phone: { type: String, required: true },
        role: { type: String, required: true },
        photo: { url: String, public_id: String },
        
        type: { type: String, enum: ["staff", "volunteer"] },
    socialLinks: [{ platform: String, url: String }],
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    type: { type: String },
        
        
    },
  { timestamps: true }
);
staffSchema.index({ createdAt: -1, _id: -1 });
staffSchema.index({ status: 1, createdAt: -1, _id: -1 });
const Staff = mongoose.model("Staff", staffSchema);

module.exports = Staff;
