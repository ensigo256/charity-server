const mongoose = require("mongoose");

const notificationsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "system",
        "visit",
        "subscription",
        "message",
        "comment",
        "like",
        "share",
        "view",
        "newsletter",
        "sponsor_due_reminder",
        "blog_like",
        "blog_share",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    linkTo: {
      type: String,
      default: "",
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    relatedEntityType: {
      type: String,
      default: null,
    },
    relatedEntityId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["unread", "read", "archived", "deleted"],
      default: "unread",
      index: true,
    },
    seen: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

notificationsSchema.index({ userId: 1, createdAt: -1, _id: -1 });
notificationsSchema.index({ userId: 1, status: 1, createdAt: -1, _id: -1 });
notificationsSchema.index({ userId: 1, type: 1, scheduledFor: 1 });
notificationsSchema.index({ createdAt: -1, _id: -1 });

const Notification = mongoose.model("Notification", notificationsSchema);

module.exports = Notification;
