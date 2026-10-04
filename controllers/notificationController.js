const notifUtil = require('../utils/notificationUtil');
const { validationResult } = require("express-validator");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");

exports.createNotification = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { type, title, description, linkTo, userId, status, scheduledFor, relatedEntityType, relatedEntityId } = req.body;
    const targetUserId = userId || req.admin?.id || req.admin?._id;

    if (!targetUserId) {
      return res.status(400).json({ message: "A userId is required to create a notification" });
    }

    const notification = await notifUtil.createNotification({
      userId: targetUserId,
      type,
      title,
      description,
      linkTo,
      status,
      scheduledFor,
      relatedEntityType,
      relatedEntityId,
    });

    res.status(201).json(notification);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.admin?.id || req.admin?._id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const filter = {
      userId,
      type: req.query.type || undefined,
      status: req.query.status && req.query.status !== 'all' ? req.query.status : undefined,
    };

    const pagination = getPagination(req);
    const { items: notifications, total } = await notifUtil.getNotifications({
      ...filter,
      ...pagination,
      withMeta: true,
    });

    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.admin?.id || req.admin?._id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const count = await notifUtil.getUnreadCount(userId);
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.markAsSeen = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.admin?.id || req.admin?._id;
    const updated = await notifUtil.markAsSeen(id, userId);

    if (!updated) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.admin?.id || req.admin?._id;
    const updated = await notifUtil.markAsRead(id, userId);

    if (!updated) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.archiveNotification = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.admin?.id || req.admin?._id;
    const updated = await notifUtil.archiveNotification(id, userId);

    if (!updated) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.admin?.id || req.admin?._id;
    const updated = await notifUtil.deleteNotification(id, userId);

    if (!updated) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
