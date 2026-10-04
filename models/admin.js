const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["developer", "admin", "editor"],
      default: "admin",
    },
    isActive: { type: Boolean, default: true, index: true },
    loggedIn: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    lastLogin: { type: Date },
    loginLogs: [{ type: Date }],
  },

  { timestamps: true },
);
const Admin = mongoose.model("Admin", adminSchema);

module.exports = Admin;
