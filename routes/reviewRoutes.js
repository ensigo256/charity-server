const express = require("express");
const { body, param } = require("express-validator");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validate");
const {
  getReviews,
  getPublicReviews,
  createReview,
  updateReview,
  deleteReview,
} = require("../controllers/reviewControllers");

const router = express.Router();
const reviewFields = [
  body("name").isString().trim().isLength({ min: 2, max: 120 }),
  body("role").isString().trim().isLength({ min: 2, max: 120 }),
  body("review").isString().trim().isLength({ min: 1, max: 3000 }),
  body("status").optional().isIn(["draft", "published"]),
  body("photo").optional().isObject(),
  body("photo.url")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["http", "https"], require_protocol: true }),
  body("photo.public_id").optional({ values: "falsy" }).isString().isLength({ max: 255 }),
];

router.get("/public", getPublicReviews);
router.get("/all", requireAuth, requirePermission("reviews.view"), getReviews);
router.post(
  "/new",
  requireAuth,
  requirePermission("reviews.manage"),
  reviewFields,
  validateRequest,
  createReview,
);
router.put(
  "/update/:id",
  requireAuth,
  requirePermission("reviews.manage"),
  param("id").isMongoId(),
  reviewFields,
  validateRequest,
  updateReview,
);
router.delete(
  "/delete/:id",
  requireAuth,
  requirePermission("reviews.manage"),
  param("id").isMongoId(),
  validateRequest,
  deleteReview,
);

module.exports = router;