const Express = require("express");
const router = Express.Router();
const rateLimit = require("express-rate-limit");
const { body, param } = require("express-validator");
const {
  createSponsor,
  createPublicPledge,
  createStripeCheckoutSession,
  confirmPublicAchPledge,
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
const { requireAuth, requirePermission } = require("../middleware/auth");
const publicPledgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many pledge attempts. Please try again later." },
});

router.post("/public/pledges", publicPledgeLimiter, createPublicPledge);
router.post("/stripe/create-session", createStripeCheckoutSession);
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
  createPaymentRecord,
);

module.exports = router;
