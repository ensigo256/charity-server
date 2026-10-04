const Events = require("../models/event");
const DeleteImage = require("../utils/deleteCloudImg");
const { validationResult } = require("express-validator");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
// const notifUtil = require('../utils/notificationUtil');

exports.createEvent = async (req, res) => {
  try {
    const {
      title,
      topic,
      date,
      time,
      location,
      category,
      description,
      status,
      image,
    } = req.body;

    const newEvent = new Events({
      title,
      topic,
      date,
      time,
      location,
      category,
      description,
      status,
      image: image || { url: "", public_id: "" },
      shares: [],
      comments: [],
    });

    await newEvent.save();

    res.status(201).json({
      message: "Event created successfully",
      newEvent,
    });
  } catch (error) {
    // logger.error('Event creation error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [events, total] = await Promise.all([
      Events.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Events.countDocuments(),
    ]);

    if (!events || events.length === 0) {
      setPaginationHeaders(res, { ...pagination, total });
      return res.status(200).json([]);
    }

    setPaginationHeaders(res, { ...pagination, total });
    // logger.info(`Retrieved ${events.length} events`);
    res.status(200).json(events);
  } catch (error) {
    // logger.error('Get events error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const event = await Events.findById(id).populate("comments").select("-__v");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // logger.info(`Event retrieved: ${id}`);
    res.status(200).json(event);
  } catch (error) {
    // logger.error('Get event by ID error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const event = await Events.findById(id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Delete associated images
    if (event.image && event.image.public_id) {
      await DeleteImage(event.image.public_id);
    }

    await Events.findByIdAndDelete(id);

    // Send notification asynchronously
    // notifUtil.notifyResourceDeleted('event', id).catch(err =>
    //     // logger.error('Failed to send event deletion notification:', err)
    // );

    // logger.info(`Event deleted: ${id} - ${event.title}`);
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    // logger.error('Event deletion error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      topic,
      date,
      time,
      location,
      category,
      description,
      status,
      image,
    } = req.body;
    const updateData = {
      title,
      topic,
      date,
      time,
      location,
      category,
      description,
      status,
      image,
    };
    const findEvent = await Events.findById(id);
    if (!findEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (
      updateData.image?.public_id &&
      findEvent.image?.public_id &&
      findEvent.image.public_id !== updateData.image.public_id
    ) {
      await DeleteImage(findEvent.image.public_id);
    }

    const event = await Events.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("comments");

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json({
      message: "Event updated successfully",
      event,
    });
  } catch (error) {
    // logger.error('Event update error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.toggleFeatured = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation errors", errors: errors.array() });
    }

    const { id } = req.params;
    const event = await Events.findById(id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Initialize isFeatured if it doesn't exist
    if (!event.isFeatured) {
      event.isFeatured = [];
    }

    const index = event.isFeatured.indexOf(id);
    if (index === -1) {
      // If already at max featured events (3), remove the oldest
      if (event.isFeatured.length >= 3) {
        event.isFeatured.shift(); // Remove first item
      }
      event.isFeatured.push(id);
    } else {
      event.isFeatured.splice(index, 1);
    }

    await event.save();

    const isFeatured = event.isFeatured.includes(id);
    // logger.info(`Event ${isFeatured ? 'featured' : 'unfeatured'}: ${id}`);
    res.status(200).json({
      message: `Event ${isFeatured ? "marked as" : "removed from"} featured`,
      isFeatured,
    });
  } catch (error) {
    // logger.error('Toggle featured error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.shareToggle = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation errors", errors: errors.array() });
    }

    const { eventId } = req.params;
    const { uuid } = req.body;

    const event = await Events.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if already shared by this user
    if (event.shares.includes(uuid)) {
      return res.status(200).json({
        message: "Event already shared by this user",
        sharesCount: event.shares.length,
      });
    }

    event.shares.push(uuid);
    await event.save();

    // logger.info(`Event shared: ${eventId} by ${uuid}`);
    res.status(200).json({
      message: "Event shared successfully",
      sharesCount: event.shares.length,
    });
  } catch (error) {
    // logger.error('Event share error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
exports.saveViews = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation errors", errors: errors.array() });
    }

    const { eventId } = req.params;
    const { uuid } = req.body;

    const event = await Events.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if view already exists
    if (event.views.includes(uuid)) {
      return res.status(200).json({
        message: "Event view already recorded",
        viewsCount: event.views.length,
      });
    }

    event.views.push(uuid);
    await event.save();

    // logger.info(`Event view recorded: ${eventId} by ${uuid}`);
    res.status(200).json({
      message: "Event view saved successfully",
      viewsCount: event.views.length,
    });
  } catch (error) {
    // logger.error('Event save view error:', error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
