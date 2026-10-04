const Express = require("express");
const { body } = require("express-validator");
const rateLimit = require("express-rate-limit");
const router = Express.Router();
const {
  registerAdmin,
  loginAdmin,
  refreshAdmin,
  getCurrentAdmin,
  logoutAdmin,
  listAdmins,
  updateAdmin,
  resetAdminPassword,
  deactivateAdmin,
  getAdminSessions,
  revokeAdminSession,
  revokeAllAdminSessions,
} = require("../controllers/adminControllers");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validate");
const { requireTrustedOrigin } = require("../middleware/csrf");

const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS ||
    "http://localhost:3000,http://localhost:3001",
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustedOrigin = requireTrustedOrigin(
  allowedOrigins,
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many refresh attempts. Please try again later." },
});

const credentialsValidation = [
  body("username")
    .trim()
    .isLength({ min: 3, max: 120 })
    .withMessage("Username must be between 3 and 120 characters"),
  body("password")
    .isString()
    .isLength({ min: 1, max: 128 })
    .withMessage("Password is required"),
];

const registrationValidation = [
  ...credentialsValidation,
  body("password").custom((password, { req }) => {
    const minimum = req.body.role === "developer" ? 12 : 6;
    if (typeof password !== "string" || password.length < minimum || password.length > 128) {
      throw new Error(`Password must be between ${minimum} and 128 characters for this role`);
    }
    return true;
  }),
];

const userIdValidation = [
  require("express-validator").param("id").isMongoId().withMessage("Invalid user id"),
];

const passwordResetValidation = [
  ...userIdValidation,
  body("password").isString().isLength({ min: 6, max: 128 }).withMessage("Password must be at least 6 and no more than 128 characters"),
];

router.post(
  "/admin/register",
  requireAuth,
  requirePermission("users.manage"),
  registrationValidation,
  body("role").optional().isIn(["developer", "admin", "editor"]).withMessage("Role must be developer, admin, or editor"),
  validateRequest,
  registerAdmin,
);
router.get(
  "/admin/users",
  requireAuth,
  requirePermission("users.manage"),
  require("express-validator").query("page").optional().isInt({ min: 1 }),
  require("express-validator").query("limit").optional().isInt({ min: 1, max: 100 }),
  require("express-validator").query("search").optional().isString().isLength({ max: 120 }),
  validateRequest,
  listAdmins,
);
router.patch(
  "/admin/users/:id",
  requireAuth,
  requirePermission("users.manage"),
  ...userIdValidation,
  body("username").optional().trim().isLength({ min: 3, max: 120 }),
  body("role").optional().isIn(["developer", "admin", "editor"]),
  body("password").optional().isString().isLength({ min: 6, max: 128 }),
  body("isActive").optional().isBoolean().toBoolean(),
  validateRequest,
  updateAdmin,
);
router.put(
  "/admin/users/:id/password",
  requireAuth,
  requirePermission("users.manage"),
  ...passwordResetValidation,
  validateRequest,
  resetAdminPassword,
);
router.delete(
  "/admin/users/:id",
  requireAuth,
  requirePermission("users.manage"),
  ...userIdValidation,
  validateRequest,
  deactivateAdmin,
);
router.get(
  "/admin/users/:id/sessions",
  requireAuth,
  requirePermission("users.manage"),
  ...userIdValidation,
  require("express-validator").query("limit").optional().isInt({ min: 1, max: 100 }),
  validateRequest,
  getAdminSessions,
);
router.post(
  "/admin/users/:id/sessions/:sessionId/revoke",
  requireAuth,
  requirePermission("users.manage"),
  ...userIdValidation,
  require("express-validator").param("sessionId").isUUID(),
  validateRequest,
  revokeAdminSession,
);
router.post(
  "/admin/users/:id/sessions/revoke-all",
  requireAuth,
  requirePermission("users.manage"),
  ...userIdValidation,
  validateRequest,
  revokeAllAdminSessions,
);
router.post("/admin/login", loginLimiter, credentialsValidation, validateRequest, loginAdmin);
router.post("/admin/refresh", trustedOrigin, refreshLimiter, refreshAdmin);
router.get("/admin/me", requireAuth, getCurrentAdmin);
router.post("/admin/logout", trustedOrigin, requireAuth, logoutAdmin);

module.exports = router;
