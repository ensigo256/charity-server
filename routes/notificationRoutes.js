const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationController');
const { body, param, query } = require('express-validator');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.post('/', requireAuth, requirePermission('notifications.manage'), [
  body('type').isString().notEmpty().withMessage('Type is required'),
  body('title').isString().notEmpty().withMessage('Title is required'),
  body('description').isString().notEmpty().withMessage('Description is required'),
  body('userId').optional().isMongoId().withMessage('User ID must be valid'),
  body('linkTo').optional().isString().withMessage('LinkTo must be a string'),
], controller.createNotification);

router.get('/', requireAuth, requirePermission('notifications.view'), [
  query('status').optional().isString().withMessage('Status must be a string'),
  query('type').optional().isString().withMessage('Type must be a string'),
  query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
], controller.getNotifications);

router.get('/unread-count', requireAuth, requirePermission('notifications.view'), controller.getUnreadCount);

router.patch('/:id/read', requireAuth, requirePermission('notifications.view'), [
  param('id').isMongoId().withMessage('Invalid notification ID'),
], controller.markAsRead);

router.patch('/:id/archive', requireAuth, requirePermission('notifications.view'), [
  param('id').isMongoId().withMessage('Invalid notification ID'),
], controller.archiveNotification);

router.delete('/:id', requireAuth, requirePermission('notifications.manage'), [
  param('id').isMongoId().withMessage('Invalid notification ID'),
], controller.deleteNotification);

router.patch('/:id/seen', requireAuth, requirePermission('notifications.view'), [
  param('id').isMongoId().withMessage('Invalid notification ID'),
], controller.markAsSeen);

module.exports = router;
