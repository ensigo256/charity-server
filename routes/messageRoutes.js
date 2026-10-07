const Express = require("express");
const rateLimit = require("express-rate-limit");
const router = Express.Router();
const { body, param } = require("express-validator");
const {
  createMessage,
  getMessages,
  getUnreadCount,
  markAsRead,
  archiveToggle,
  deleteMessage,
  replyToMessage,
} = require("../controllers/messageControllers.js.js");
const { requireAuth, requirePermission } = require("../middleware/auth");
const publicMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many messages. Please try again later." },
});

const messageBodyValidation = [
    body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters"),
    body("email").isLength({ max: 254 }).isEmail().withMessage("Valid email is required"),
    body("subject").trim().isLength({ min: 2, max: 160 }).withMessage("Subject is required"),
    body("phone").optional({ values: "falsy" }).isLength({ max: 40 }).withMessage("Phone number is too long"),
    body("role").optional({ values: "falsy" }).isLength({ max: 80 }).withMessage("Role is too long"),
    body("message").trim().isLength({ min: 10, max: 5000 }).withMessage("Message must be between 10 and 5000 characters"),
  ];

router.post("/contact", publicMessageLimiter, messageBodyValidation, createMessage);
router.post("/volunteers/create", publicMessageLimiter, messageBodyValidation, createMessage);

router.get("/all", requireAuth, requirePermission("messages.view"), getMessages);
router.get("/unread-count", requireAuth, requirePermission("messages.view"), getUnreadCount);

router.post("/:id/mark-read",
  requireAuth,
  requirePermission("messages.view"),
  [
    param('id').isMongoId().withMessage('Invalid message ID')
  ],
  markAsRead
);

router.post("/:id/toggle-archive",
  requireAuth,
  requirePermission("messages.manage"),
  [
    param('id').isMongoId().withMessage('Invalid message ID')
  ],
  archiveToggle
);

router.delete("/:id/delete",
  requireAuth,
  requirePermission("messages.manage"),
  [
    param('id').isMongoId().withMessage('Invalid message ID')
  ],
  deleteMessage
);

router.post("/:id/reply",
  requireAuth,
  requirePermission("messages.manage"),
  [
    param('id').isMongoId().withMessage('Invalid message ID'),
    body('reply').isLength({ min: 1 }).withMessage('Reply is required')
  ],
  replyToMessage
);

module.exports = router;