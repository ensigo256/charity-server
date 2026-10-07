const Express = require("express");
const router = Express.Router();
const rateLimit = require("express-rate-limit");
const { body, param } = require("express-validator");
const { validateRequest } = require("../middleware/validate");
const {
  createSponsor,
  createPublicPledge,
  createPublicStripePaymentLinkPledge,
  retryPublicAchInstructionEmail,
  getPendingPublicAchPledges,
  getPendingPublicStripePledges,
  createStripeCheckoutSession,
  confirmPublicAchPledge,
  confirmPublicStripePledge,
  cancelPublicPledge,
  getSponsorRecords,
  getSponsorById,
  createPaymentRecord,
  getSponsorChildren,
  getChildSponsor,
  updateSponsorshipStatus,
  reassignSponsor,
  updateSponsorProfile,
  getProfiles,
  archiveSponsorProfile,
  unlinkChildSponsor,
  recordSplitPayment,
  checkSponsorReminderNotifications,
} = require("../controllers/sponsorControllers");
const { requireAuth, requirePermission, requireRole } = require("../middleware/auth");
const { getAchSettings, updateAchSettings } = require("../controllers/achSettingsController");
const {
  getAdminStripePaymentLink,
  getPublicStripePaymentLink,
  updateStripePaymentLink,
} = require("../controllers/stripePaymentLinkSettingsController");
const publicPledgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many pledge attempts. Please try again later." },
});
const stripeCheckoutSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many checkout attempts. Please try again later." },
});
const splitPaymentFields = [
  body("amount").isInt({ min: 1, max: 1000000 }),
  body("currency").optional().matches(/^[A-Z]{3}$/),
  body("date").optional().isISO8601(),
  body("method").isIn(["Cash", "Bank Transfer", "Mobile Money", "ACH", "PayPal", "Zelle", "Stripe", "Check", "Other"]),
  body("transactionId").trim().isLength({ min: 1, max: 255 }),
  body("notes").optional().isString().isLength({ max: 1000 }),
  body("allocationMode").optional().isIn(["custom", "equal"]),
  body("allocations").isArray({ min: 1, max: 50 }),
  body("allocations.*.sponsorshipId").isMongoId(),
  body("allocations.*.childId").isMongoId(),
  body("allocations.*.amount").isInt({ min: 1, max: 1000000 }),
];

router.post("/public/pledges", publicPledgeLimiter, createPublicPledge);
router.post("/stripe/payment-link-pledges", publicPledgeLimiter, createPublicStripePaymentLinkPledge);
router.post(
  "/stripe/create-session",
  stripeCheckoutSessionLimiter,
  createStripeCheckoutSession,
);
router.get("/settings/ach", requireAuth, requireRole("admin"), getAchSettings);
router.put("/settings/ach", requireAuth, requireRole("admin"), updateAchSettings);
router.get("/settings/stripe-payment-link/public", getPublicStripePaymentLink);
router.get("/settings/stripe-payment-link", requireAuth, requireRole("admin"), getAdminStripePaymentLink);
router.put("/settings/stripe-payment-link", requireAuth, requireRole("admin"), updateStripePaymentLink);
router.get(
  "/public/pledges/pending",
  requireAuth,
  requirePermission("sponsorships.view"),
  getPendingPublicAchPledges,
);
router.get(
  "/stripe/payment-link-pledges/pending",
  requireAuth,
  requirePermission("sponsorships.view"),
  getPendingPublicStripePledges,
);
router.post(
  "/stripe/payment-link-pledges/:id/confirm",
  requireAuth,
  requirePermission("sponsorships.manage"),
  confirmPublicStripePledge,
);
router.post(
  "/public/pledges/:id/retry-ach-email",
  requireAuth,
  requireRole("admin"),
  retryPublicAchInstructionEmail,
);
router.post(
  "/public/pledges/:id/confirm-ach",
  requireAuth,
  requirePermission("sponsorships.manage"),
  confirmPublicAchPledge,
);
router.post(
  "/public/pledges/:id/cancel",
  requireAuth,
  requirePermission("sponsorships.manage"),
  cancelPublicPledge,
);
// Create a new sponsor
router.post(
  "/profile/new",
  requireAuth,
  requirePermission("sponsorships.manage"),
  createSponsor,
);

// Complete or edit a sponsor profile
router.patch(
  "/profile/:id",
  requireAuth,
  requirePermission("sponsorships.manage"),
  param("id").isMongoId(),
  body("profile").optional().isObject(),
  body("profile.fullName").optional().isString().isLength({ min: 2, max: 120 }),
  body("profile.email").optional().isEmail().isLength({ max: 254 }),
  body("profile.phone").optional().isString().isLength({ max: 40 }),
  body("profile.country").optional().isString().isLength({ max: 100 }),
  body("profile.city").optional().isString().isLength({ max: 100 }),
  body("profile.state").optional().isString().isLength({ max: 100 }),
  body("profile.region").optional().isString().isLength({ max: 100 }),
  body("profile.zipCode").optional().isString().isLength({ max: 30 }),
  body("profile.bio").optional().isString().isLength({ max: 2000 }),
  body("donation").optional().isObject(),
  body("donation.amount").optional().isFloat({ min: 0, max: 100000 }),
  body("donation.period").optional().isIn(["Monthly", "3 Months", "6 Months", "Yearly"]),
  body("donation.expectedFundsDate")
    .optional({ values: "falsy" })
    .isISO8601({ strict: true, strictSeparator: true }),
  body("donation.remindByEmail").optional().isBoolean(),
  body("image").optional().isObject(),
  body("image.url").optional().isURL({ protocols: ["https"], require_protocol: true }),
  body("image.public_id").optional().isString().isLength({ min: 1, max: 255 }),
  validateRequest,
  updateSponsorProfile,
);

// Archive a sponsor profile while preserving sponsorship and payment history
router.delete(
  "/profile/:id",
  requireAuth,
  requirePermission("sponsorships.manage"),
  archiveSponsorProfile,
);

// Get all sponsor records
router.get(
  "/sponsorship/records",
  requireAuth,
  requirePermission("sponsorships.view"),
  getSponsorRecords,
);

// Get all sponsor profiles
router.get(
  "/profiles/all",
  requireAuth,
  requirePermission("sponsorships.view"),
  getProfiles,
);

// Get sponsor assignment records for a child
router.get(
  "/child/:childId",
  requireAuth,
  requirePermission("sponsorships.view"),
  getChildSponsor,
);

// Get sponsored children for a sponsor
router.get(
  "/:id/children",
  requireAuth,
  requirePermission("sponsorships.view"),
  getSponsorChildren,
);

// Get sponsor by id including child relationship summary
router.get(
  "/:id",
  requireAuth,
  requirePermission("sponsorships.view"),
  getSponsorById,
);

// Unlink a child from its current sponsor while preserving sponsorship history
router.patch(
  "/child/:childId/unlink",
  requireAuth,
  requirePermission("sponsorships.manage"),
  unlinkChildSponsor,
);

// Record one manual donation across one or more child sponsorships
router.post(
  "/:sponsorId/payments/split",
  requireAuth,
  requirePermission("sponsorships.manage"),
  param("sponsorId").isMongoId(),
  splitPaymentFields,
  validateRequest,
  recordSplitPayment,
);

router.post(
  "/due-reminders/check",
  requireAuth,
  requirePermission("sponsorships.manage"),
  checkSponsorReminderNotifications,
);

// Update sponsorship lifecycle status
router.patch(
  "/sponsorship/:id/status",
  requireAuth,
  requirePermission("sponsorships.manage"),
  updateSponsorshipStatus,
);

// Reassign a sponsor to a child
router.patch(
  "/reassign",
  requireAuth,
  requirePermission("sponsorships.manage"),
  reassignSponsor,
);

// Create a new payment record
router.post(
  "/sponsorship/:id/new/payment",
  requireAuth,
  requirePermission("sponsorships.manage"),
  param("id").isMongoId(),
  body("amount").isFloat({ gt: 0, max: 1000000 }),
  body("method").isIn(["Cash", "Bank Transfer", "Mobile Money", "ACH", "PayPal", "Zelle", "Stripe", "Check", "Other"]),
  body("transactionId").isString().trim().isLength({ min: 1, max: 255 }),
  body("notes").optional().isString().isLength({ max: 1000 }),
  validateRequest,
  createPaymentRecord,
);

module.exports = router;
