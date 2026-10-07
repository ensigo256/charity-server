const Express = require("express");
const router = Express.Router();
const { body, param } = require("express-validator");
const {
  uploadImage,
  updateStaff,
  createStaff,
  getStaff,
  deleteStaff,
} = require("../controllers/staffControllers");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validate");

const staffFields = [
  body("name").trim().isLength({ min: 2, max: 120 }),
  body("email").isLength({ max: 254 }).isEmail(),
  body("phone").trim().isLength({ min: 3, max: 40 }),
  body("role").trim().isLength({ min: 2, max: 120 }),
  body("type").isIn(["staff", "volunteer"]),
  body("status").optional().isIn(["active", "inactive"]),
  body("photo").optional().isObject(),
  body("photo.url")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["http", "https"], require_protocol: true }),
  body("photo.public_id").optional({ values: "falsy" }).isString().isLength({ max: 255 }),
  body("socialLinks").optional().isArray({ max: 20 }),
  body("socialLinks.*.platform").optional().isString().isLength({ max: 80 }),
  body("socialLinks.*.url")
    .optional()
    .isURL({ protocols: ["http", "https"], require_protocol: true }),
];

router.post(
  "/new",
  requireAuth,
  requirePermission("staff.manage"),
  staffFields,
  validateRequest,
  createStaff,
);

router.get("/all", requireAuth, requirePermission("staff.view"), getStaff);

router.delete(
  "/delete/:id",
  requireAuth,
  requirePermission("staff.manage"),
  param("id").isMongoId(),
  validateRequest,
  deleteStaff,
);

router.put(
  "/update/:id",
  requireAuth,
  requirePermission("staff.manage"),
  param("id").isMongoId(),
  staffFields,
  validateRequest,
  updateStaff,
);

module.exports = router;
