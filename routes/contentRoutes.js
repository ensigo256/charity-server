const express = require("express");
const { body, param, query } = require("express-validator");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validate");
const {
  getContent,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
} = require("../controllers/contentControllers");

const router = express.Router();
const contentQueryValidation = [
  query("section").optional().isString().isLength({ max: 100 }),
  query("status").optional().isIn(["published", "draft"]),
  validateRequest,
];
const contentWriteValidation = [
  body("id").optional().matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
  body("title").isString().trim().isLength({ min: 1, max: 160 }),
  body("section").isString().trim().isLength({ min: 1, max: 100 }),
  body("content").isString().isLength({ min: 1, max: 100000 }),
  body("status").optional().isIn(["draft", "published"]),
  validateRequest,
];

router.get("/", contentQueryValidation, getContent);
router.get("/all", requireAuth, requirePermission("content.view"), contentQueryValidation, getContent);
router.get("/:id", param("id").isLength({ min: 1, max: 100 }), validateRequest, getContentById);
router.post(
  "/",
  requireAuth,
  requirePermission("content.manage"),
  contentWriteValidation,
  createContent,
);
router.put(
  "/:id",
  requireAuth,
  requirePermission("content.manage"),
  param("id").isLength({ min: 1, max: 100 }),
  contentWriteValidation,
  validateRequest,
  updateContent,
);
router.delete(
  "/:id",
  requireAuth,
  requirePermission("content.manage"),
  param("id").isLength({ min: 1, max: 100 }),
  validateRequest,
  deleteContent,
);

module.exports = router;
