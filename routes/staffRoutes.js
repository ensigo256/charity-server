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

router.post(
  "/new",
  requireAuth,
  requirePermission("staff.manage"),
  createStaff,
);

router.get("/all", requireAuth, requirePermission("staff.view"), getStaff);

router.delete(
  "/delete/:id",
  requireAuth,
  requirePermission("staff.manage"),
  deleteStaff,
);

router.put(
  "/update/:id",
  requireAuth,
  requirePermission("staff.manage"),
  updateStaff,
);

module.exports = router;
