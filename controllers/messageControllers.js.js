const { Resend } = require("resend");
const Messages = require("../models/message");
const Sponsor = require("../models/sponsor");
const { validationResult } = require("express-validator");
const { sendContactEmails, sendReplyEmail, sendEmail } = require("../utils/mail");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const notifUtil = require("../utils/notificationUtil");

function normalizeRecipient(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return normalizeRecipient(value.email || value.address || value.value || "");
  }
  return String(value).trim().toLowerCase();
}

function normalizeThreadId(value) {
  return value ? String(value).trim() : "";
}

exports.createMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { name, email, subject, phone = "", role = "contact", message } = req.body;
    const newMessage = new Messages({
      name,
      email,
      subject,
      phone,
      role,
      message,
      direction: "inbound",
      source: "contact",
      isRead: false,
      isArchived: false,
    });

    await newMessage.save();

    notifUtil.notifyNewMessage(newMessage).catch((error) => {
      console.error("Failed to create message notification:", error.message);
    });

    const emailResult = await sendContactEmails(newMessage).catch((error) => {
      console.error("Message saved, but contact emails failed:", error.message);
      return { sent: false, error: error.message };
    });

    res.status(201).json({
      message: "Message sent successfully",
      messageId: newMessage._id,
      emailSent: emailResult.sent,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [messages, total] = await Promise.all([
      Messages.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select("-__v"),
      Messages.countDocuments(),
    ]);

    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const message = await Messages.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.threadId) {
      await Messages.updateMany({ threadId: message.threadId }, { $set: { isRead: true } });
    } else {
      message.isRead = true;
      await message.save();
    }

    res.status(200).json({ message: "Message marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Messages.countDocuments({ isRead: false, isArchived: false });
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.archiveToggle = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const message = await Messages.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const nextArchived = !message.isArchived;
    if (message.threadId) {
      await Messages.updateMany({ threadId: message.threadId }, { $set: { isArchived: nextArchived } });
    } else {
      message.isArchived = nextArchived;
      await message.save();
    }

    const status = nextArchived ? "archived" : "unarchived";
    res.status(200).json({
      message: `Message ${status} successfully`,
      isArchived: nextArchived,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const message = await Messages.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.threadId) {
      await Messages.deleteMany({ threadId: message.threadId });
    } else {
      await Messages.findByIdAndDelete(id);
    }
    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.replyToMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const { reply } = req.body;

    const message = await Messages.findById(id);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const inboundMessageId = message.providerMeta?.messageId;
    const emailResult = await sendReplyEmail(
      message,
      reply,
      inboundMessageId ? { "In-Reply-To": inboundMessageId } : {},
    );

    const threadId = message.threadId || String(message._id);
    message.threadId = threadId;
    message.reply = { reply, repliedOn: new Date() };
    await message.save();
    await Messages.create({
      name: message.name || message.email,
      email: message.email,
      from: process.env.MAIL_FROM || "",
      to: [normalizeRecipient(message.email)],
      subject: `Re: ${message.subject}`,
      message: reply,
      text: reply,
      direction: "outbound",
      source: "dashboard",
      threadId,
      parentMessageId: message._id,
      providerMessageId: emailResult.providerMessageId || null,
      provider: emailResult.provider,
      status: "sent",
      isRead: true,
    });

    res.status(200).json({
      message: "Reply added to message successfully",
      reply: message.reply,
      emailSent: emailResult.sent,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.processResendWebhook = async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "Empty webhook payload" });
    }

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ message: "RESEND_WEBHOOK_SECRET is not configured" });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ message: "RESEND_API_KEY is not configured" });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const resend = new Resend(process.env.RESEND_API_KEY);
    let payload;
    try {
      payload = resend.webhooks.verify({
        payload: rawBody.toString("utf8"),
        headers: {
          id: req.headers["svix-id"],
          timestamp: req.headers["svix-timestamp"],
          signature: req.headers["svix-signature"],
        },
        webhookSecret,
      });
    } catch {
      return res.status(401).json({ message: "Invalid Resend webhook signature" });
    }
    if (payload.type !== "email.received" || !payload.data?.email_id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const providerMessageId = payload.data.email_id;
    const existing = await Messages.findOne({ source: "resend", providerMessageId });
    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true, messageId: existing._id });
    }

    const { data: inboundEmail, error } = await resend.emails.receiving.get(providerMessageId);
    if (error) {
      console.error("Unable to retrieve received Resend email:", error);
      return res.status(502).json({ message: "Unable to retrieve received email from Resend" });
    }
    if (!inboundEmail) {
      return res.status(502).json({ message: "Resend returned no received email data" });
    }

    const parseAddress = (value) => {
      const address = String(value || "").match(/<([^>]+)>/);
      return normalizeRecipient(address ? address[1] : value);
    };
    const sender = parseAddress(inboundEmail.from || payload.data.from);
    const senderName = String(inboundEmail.from || payload.data.from || "")
      .replace(/<[^>]+>/, "")
      .trim()
      .replace(/^"|"$/g, "") || sender.split("@")[0] || "Unknown sender";
    const recipients = Array.isArray(inboundEmail.to || payload.data.to)
      ? (inboundEmail.to || payload.data.to).map(parseAddress).filter(Boolean)
      : [];
    const emailHeaders = Object.fromEntries(
      Object.entries(inboundEmail.headers || {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );

    const record = await Messages.create({
      name: senderName,
      email: sender,
      from: sender,
      to: recipients,
      subject: inboundEmail.subject || payload.data.subject || "No subject",
      message: inboundEmail.text || "",
      text: inboundEmail.text || "",
      html: inboundEmail.html || "",
      direction: "inbound",
      source: "resend",
      threadId: String(emailHeaders["message-id"] || payload.data.message_id || providerMessageId),
      providerMessageId,
      provider: "resend",
      providerMeta: {
        messageId: emailHeaders["message-id"] || payload.data.message_id || "",
        inReplyTo: emailHeaders["in-reply-to"] || "",
        headers: emailHeaders,
        attachments: inboundEmail.attachments || [],
      },
      status: "delivered",
      isRead: false,
      isArchived: false,
    });

    return res.status(200).json({ ok: true, messageId: record._id });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await Messages.findOne({
        source: "resend",
        providerMessageId: error.keyValue?.providerMessageId,
      });
      if (duplicate) {
        return res.status(200).json({ ok: true, duplicate: true, messageId: duplicate._id });
      }
    }
    console.error("Resend webhook error:", error.message);
    return res.status(500).json({ message: "Unable to process Resend webhook" });
  }
};

exports.getSponsorRecipients = async (_req, res) => {
  try {
    const sponsors = await Sponsor.find({
      isArchived: { $ne: true },
      "profile.email": { $type: "string", $ne: "" },
    })
      .select("_id profile.fullName profile.email")
      .sort({ "profile.fullName": 1 })
      .limit(500)
      .lean();
    res.status(200).json(
      sponsors.map((sponsor) => ({
        id: String(sponsor._id),
        name: sponsor.profile?.fullName || "",
        email: normalizeRecipient(sponsor.profile?.email),
      })),
    );
  } catch (error) {
    console.error("Sponsor recipient lookup failed:", error.message);
    res.status(500).json({ message: "Unable to load sponsor recipients" });
  }
};

exports.sendDirectMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { sponsorId, subject, message } = req.body;
    const sponsor = await Sponsor.findOne({
      _id: sponsorId,
      isArchived: { $ne: true },
    }).select("_id profile.fullName profile.email");
    const recipient = normalizeRecipient(sponsor?.profile?.email);
    if (!sponsor || !recipient) {
      return res.status(404).json({ message: "Sponsor with an active email address not found" });
    }

    const delivery = await sendEmail({
      to: recipient,
      replyTo: process.env.CONTACT_RECIPIENT || process.env.SMTP_USER,
      subject: subject.trim(),
      text: message.trim(),
    });
    const saved = await Messages.create({
      name: sponsor.profile.fullName,
      email: recipient,
      from: process.env.MAIL_FROM || "",
      to: [recipient],
      subject: subject.trim(),
      message: message.trim(),
      text: message.trim(),
      direction: "outbound",
      source: "dashboard",
      threadId: `sponsor-${sponsor._id}-${Date.now()}`,
      providerMessageId: delivery.providerMessageId || null,
      provider: delivery.provider,
      providerMeta: { sponsorId: String(sponsor._id) },
      status: "sent",
      isRead: true,
    });
    res.status(200).json({
      message: "Email sent successfully",
      messageId: saved._id,
      provider: delivery.provider,
    });
  } catch (error) {
    console.error("Direct send error:", error.message);
    res.status(502).json({ message: "Unable to send email" });
  }
};
 
