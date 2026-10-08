const Review = require("../models/review");
const DeleteImage = require("../utils/deleteCloudImg");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");

function reviewPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    role: String(body.role || "").trim(),
    review: String(body.review || "").trim(),
    photo: body.photo || { url: "", public_id: "" },
    status: body.status || "draft",
  };
}

exports.getReviews = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [reviews, total] = await Promise.all([
      Review.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select("-__v"),
      Review.countDocuments(),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    return res.status(200).json(reviews);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load reviews", error: error.message });
  }
};

exports.getPublicReviews = async (_req, res) => {
  try {
    const reviews = await Review.find({ status: "published" })
      .sort({ createdAt: -1, _id: -1 })
      .select("name role review photo.url")
      .lean();
    return res.status(200).json(reviews);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load reviews", error: error.message });
  }
};

exports.createReview = async (req, res) => {
  try {
    const payload = reviewPayload(req.body);
    const review = await Review.create(payload);
    return res.status(201).json({ message: "Review created successfully", review });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create review", error: error.message });
  }
};

exports.updateReview = async (req, res) => {
  try {
    const payload = reviewPayload(req.body);
    const existing = await Review.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Review not found" });

    if (
      existing.photo?.public_id &&
      payload.photo.public_id !== existing.photo.public_id
    ) {
      await DeleteImage(existing.photo.public_id);
    }

    const review = await Review.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    return res.status(200).json({ message: "Review updated successfully", review });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update review", error: error.message });
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (review.photo?.public_id) await DeleteImage(review.photo.public_id);
    await Review.findByIdAndDelete(req.params.id);
    return res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete review", error: error.message });
  }
};