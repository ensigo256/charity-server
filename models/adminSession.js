const mongoose = require("mongoose");

const adminSessionSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    sessionId: { type: String, required: true, unique: true },
    refreshTokenId: { type: String, default: null },
    loginAt: { type: Date, required: true, default: Date.now },
    lastActivityAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    loggedOutAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revocationReason: { type: String, trim: true, default: "" },
    ipAddress: { type: String, trim: true, default: "" },
    userAgent: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

adminSessionSchema.index({ admin: 1, loginAt: -1 });
adminSessionSchema.index({ admin: 1, revokedAt: 1, expiresAt: 1, lastActivityAt: -1 });

module.exports = mongoose.model("AdminSession", adminSessionSchema);