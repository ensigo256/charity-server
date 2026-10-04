const Express = require("express");
const router = Express.Router();
const { body, param } = require("express-validator");
const { createComment, likeToggle, deleteComment } = require("../controllers/commentsController");
const { requireAuth, requirePermission } = require("../middleware/auth");

router.post("/new",
  requireAuth,
  requirePermission("comments.manage"),
  createComment
);

router.post("/:commentId/toggle-like",
  requireAuth,
  requirePermission("comments.manage"),
  likeToggle
);

router.post("/remove/comment/:id",
  requireAuth,
  requirePermission("comments.manage"),
  [
    param('id').isMongoId().withMessage('Invalid comment ID')
  ],
  deleteComment
);

module.exports = router;