const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');
const router = express.Router();
const newsletterSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many newsletter requests. Please try again later.' },
});
const newsletterResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many verification requests. Please try again later.' },
});
const { body, param } = require('express-validator');
const {
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
  getNewsletterSubscribers,
  verifyNewsletterSubscription,
  resendNewsletterVerification,
} = require('../controllers/newsletterController');

router.get('/subscribers', requireAuth, requirePermission('newsletter.view'), getNewsletterSubscribers);

router.get('/verify/:token', verifyNewsletterSubscription);

router.post(
  '/subscribe',
  [
    newsletterSubmitLimiter,
    body('email').isLength({ max: 254 }).isEmail().withMessage('A valid email is required.'),
    body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters if provided.'),
  ],
  subscribeToNewsletter,
);

router.post(
  '/resend-verification',
  [
    newsletterResendLimiter,
    body('email').isLength({ max: 254 }).isEmail().withMessage('A valid email is required.'),
  ],
  resendNewsletterVerification,
);

router.post(
  '/unsubscribe/:token',
  [
    param('token').isHexadecimal().isLength({ min: 48, max: 48 }).withMessage('A valid unsubscribe token is required.'),
  ],
  unsubscribeFromNewsletter,
);

module.exports = router;
