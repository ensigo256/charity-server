const Express = require("express");
const router = Express.Router();
const { body, param } = require("express-validator");
const {
  createChildProfile,
  getProfiles,
  getPublicProfiles,
  getChildProfileById,
  getPublicChildProfileById,
  updateChildProfile,
  deleteChildProfile,
  addReportCard,
  deleteReportCard,
} = require("../controllers/childProfileControllers");
const { requireAuth, requirePermission } = require("../middleware/auth");

router.get("/public/profiles", getPublicProfiles);
router.get("/public/profile/:id", getPublicChildProfileById);

// Create a new child profile
router.post(
  "/profile/new",
  requireAuth,
  requirePermission("children.manage"),
  createChildProfile,
);

//update child profile
router.put(
  "/profile/:id/update",
  requireAuth,
  requirePermission("children.manage"),
  updateChildProfile,
);

// Get all child profiles
router.get("/profiles", requireAuth, requirePermission("children.view"), getProfiles);

//delete child profile
router.delete(
  "/profile/:id/delete",
  requireAuth,
  requirePermission("children.manage"),
  deleteChildProfile,
);

// Report-card document management
router.post(
  "/profile/:id/report-cards",
  requireAuth,
  requirePermission("children.manage"),
  addReportCard,
);
router.delete(
  "/profile/:id/report-cards/:reportCardId",
  requireAuth,
  requirePermission("children.manage"),
  deleteReportCard,
);

// Get a child profile by ID
router.get(
  "/profile/:id",
  requireAuth,
  requirePermission("children.view"),
  getChildProfileById,
);

module.exports = router;
