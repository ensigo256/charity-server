const mongoose = require("mongoose");

const messagesSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    from: { type: String, default: "", trim: true, lowercase: true },
    to: [{ type: String, trim: true, lowercase: true }],
    subject: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    role: { type: String, default: "contact", trim: true },
    message: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    html: { type: String, default: "", trim: true },
    direction: {
      type: String,
      enum: ["inbound", "outbound", "internal"],
      default: "inbound",
    },
    source: {
      type: String,
      enum: ["contact", "resend", "dashboard", "system"],
      default: "contact",
    },
    threadId: { type: String, default: "", index: true },
    parentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    providerMessageId: { type: String, default: null },
    provider: { type: String, default: "" },
    providerMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["new", "queued", "sent", "delivered", "failed", "archived"],
      default: "new",
    },
    reply: { reply: String, repliedOn: Date },
    isRead: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);
messagesSchema.index({ createdAt: -1, _id: -1 });
messagesSchema.index({ isRead: 1, isArchived: 1, createdAt: -1, _id: -1 });
messagesSchema.index({ source: 1, direction: 1, createdAt: -1, _id: -1 });
messagesSchema.index(
  { source: 1, providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: "string" } } },
);
const Messages = mongoose.model("Message", messagesSchema);

module.exports = Messages;
