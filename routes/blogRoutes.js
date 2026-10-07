const Express = require("express");
const rateLimit = require("express-rate-limit");
const router = Express.Router();
const { body, param } = require("express-validator");
const {
  createBlog,
  getBlogById,
  getBlogs,
  deleteBlog,
  updateBlog,
  publishBlog,
  likeToggle,
  saveViews,
  shareToggle,
  toggledFetaured,
} = require("../controllers/blogControllers");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validate");
const { isValidPublicInteractionId } = require("../utils/publicInteractionId");
const publicInteractionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many interactions. Please try again later." },
});

const blogFields = [
  body("title").trim().isLength({ min: 2, max: 160 }),
  body("excerpt").trim().isLength({ min: 1, max: 500 }),
  body("content").isString().isLength({ min: 1, max: 100000 }),
  body("author").trim().isLength({ min: 1, max: 120 }),
  body("category").trim().isLength({ min: 1, max: 80 }),
  body("status").optional().isIn(["draft", "published"]),
  body("videoId").optional({ values: "falsy" }).isString().isLength({ max: 200 }),
  body("imageUrl")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["http", "https"], require_protocol: true }),
  body("image").optional().isObject(),
  body("image.url")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["http", "https"], require_protocol: true }),
  body("image.public_id").optional({ values: "falsy" }).isString().isLength({ max: 255 }),
];

router.post(
  "/new",
  requireAuth,
  requirePermission("blogs.manage"),
  blogFields,
  validateRequest,
  createBlog,
);

router.get("/all", getBlogs);

router.get(
  "/:id",

  getBlogById,
);

router.delete(
  "/delete/:id",
  requireAuth,
  requirePermission("blogs.manage"),
  deleteBlog,
);

router.put(
  "/:id/update",
  requireAuth,
  requirePermission("blogs.manage"),
  param("id").isMongoId(),
  blogFields,
  validateRequest,
  updateBlog,
);

router.put(
  "/publish/blog/:id",
  requireAuth,
  requirePermission("blogs.manage"),
  publishBlog,
);

router.post(
  "/:blogId/toggle-like",
  publicInteractionLimiter,
  param("blogId").isMongoId(),
  body("uuid").custom(isValidPublicInteractionId).withMessage("A valid interaction ID is required."),
  validateRequest,
  likeToggle,
);

router.post(
  "/:blogId/log-share",
  publicInteractionLimiter,
  param("blogId").isMongoId(),
  body("uuid").custom(isValidPublicInteractionId).withMessage("A valid interaction ID is required."),
  validateRequest,
  shareToggle,
);

router.post(
  "/:blogId/log-view",
  publicInteractionLimiter,
  param("blogId").isMongoId(),
  body("uuid").custom(isValidPublicInteractionId).withMessage("A valid interaction ID is required."),
  validateRequest,
  saveViews,
);

router.put(
  "/:id/toggle-featured",
  requireAuth,
  requirePermission("blogs.manage"),
  toggledFetaured,
);

module.exports = router;
