const Notification = require('../models/notification');
const Admin = require('../models/admin');
const { differenceInCalendarDays, startOfDay } = require('date-fns');

function normalizeStatus(status) {
  if (!status) return 'unread';
  const normalized = String(status).toLowerCase();
  if (['unread', 'read', 'archived', 'deleted'].includes(normalized)) {
    return normalized;
  }
  return 'unread';
}

async function createNotification({
  userId,
  type,
  title,
  description,
  linkTo = '',
  status = 'unread',
  scheduledFor = null,
  relatedEntityType = null,
  relatedEntityId = null,
}) {
  if (!userId) {
    throw new Error('userId is required to create a notification');
  }

  const normalizedStatus = normalizeStatus(status);
  const notification = await Notification.create({
    userId,
    type,
    title,
    description,
    linkTo,
    status: normalizedStatus,
    seen: normalizedStatus !== 'unread',
    scheduledFor,
    relatedEntityType,
    relatedEntityId,
    readAt: normalizedStatus === 'read' ? new Date() : null,
    archivedAt: normalizedStatus === 'archived' ? new Date() : null,
    deletedAt: normalizedStatus === 'deleted' ? new Date() : null,
  });
  return notification;
}

async function createNotificationForUsers({
  userIds,
  type,
  title,
  description,
  linkTo = '',
  status = 'unread',
  scheduledFor = null,
  relatedEntityType = null,
  relatedEntityId = null,
}) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  const notifications = await Promise.all(
    userIds.map((userId) =>
      createNotification({
        userId,
        type,
        title,
        description,
        linkTo,
        status,
        scheduledFor,
        relatedEntityType,
        relatedEntityId,
      }),
    ),
  );

  return notifications;
}

async function getActiveAdminUserIds() {
  const admins = await Admin.find({ isActive: true }).select('_id').lean();
  return admins.map((admin) => admin._id.toString());
}

async function notifyNewMessage(msg, userIds = null) {
  if (!msg || !msg._id) {
    throw new Error('message document required to generate notification');
  }

  const targetUserIds = userIds || [msg.userId || msg.adminId || msg.recipientId].filter(Boolean);
  const adminUserIds = targetUserIds.length > 0 ? targetUserIds : await getActiveAdminUserIds();

  return createNotificationForUsers({
    userIds: adminUserIds,
    type: 'message',
    title: 'New message',
    description: `You have received a new message from ${msg.name || 'a visitor'}`,
    linkTo: '/dashboard/messages',
    relatedEntityType: 'message',
    relatedEntityId: String(msg._id),
  });
}

async function notifyNewsletterSubscription({ subscriber, userIds = null } = {}) {
  if (!subscriber) {
    throw new Error('subscriber document required to generate newsletter notification');
  }

  const targetUserIds = userIds || await getActiveAdminUserIds();

  return createNotificationForUsers({
    userIds: targetUserIds,
    type: 'newsletter',
    title: 'New newsletter subscription',
    description: `${subscriber.name || subscriber.email || 'A new subscriber'} subscribed to the newsletter${subscriber.email ? ` (${subscriber.email})` : ''}.`,
    linkTo: '/dashboard/content',
    relatedEntityType: 'newsletter',
    relatedEntityId: String(subscriber._id || subscriber.email || 'newsletter'),
  });
}

async function notifyBlogLike({ blog, actorName = 'Someone', userIds = null } = {}) {
  if (!blog || !blog._id) {
    throw new Error('blog document required to generate blog like notification');
  }

  const targetUserIds = userIds || await getActiveAdminUserIds();

  return createNotificationForUsers({
    userIds: targetUserIds,
    type: 'blog_like',
    title: 'Blog post liked',
    description: `${actorName} liked the blog "${blog.title || 'Untitled'}".`,
    linkTo: `/dashboard/blogs/${blog._id}`,
    relatedEntityType: 'blog',
    relatedEntityId: String(blog._id),
  });
}

async function notifyBlogShare({ blog, actorName = 'Someone', userIds = null } = {}) {
  if (!blog || !blog._id) {
    throw new Error('blog document required to generate blog share notification');
  }

  const targetUserIds = userIds || await getActiveAdminUserIds();

  return createNotificationForUsers({
    userIds: targetUserIds,
    type: 'blog_share',
    title: 'Blog post shared',
    description: `${actorName} shared the blog "${blog.title || 'Untitled'}".`,
    linkTo: `/dashboard/blogs/${blog._id}`,
    relatedEntityType: 'blog',
    relatedEntityId: String(blog._id),
  });
}

function notifySystem(title, description, linkTo, userId) {
  return createNotification({ userId, type: 'system', title, description, linkTo });
}

function notifyResourceCreated(resourceName, doc = {}, linkTo, userId) {
  const desc = `A new ${resourceName} was created${doc?.name || doc?.title ? `: ${doc.name || doc.title}` : ''}`;
  return createNotification({
    userId,
    type: 'system',
    title: `${capitalize(resourceName)} created`,
    description: desc,
    linkTo,
  });
}

function notifyResourceUpdated(resourceName, doc = {}, linkTo, userId) {
  const desc = `An existing ${resourceName} was updated${doc._id ? ` (id: ${doc._id})` : ''}`;
  return createNotification({
    userId,
    type: 'system',
    title: `${capitalize(resourceName)} updated`,
    description: desc,
    linkTo,
  });
}

function notifyResourceDeleted(resourceName, id, linkTo, userId) {
  const desc = `A ${resourceName} was deleted${id ? ` (id: ${id})` : ''}`;
  return createNotification({
    userId,
    type: 'system',
    title: `${capitalize(resourceName)} deleted`,
    description: desc,
    linkTo,
  });
}

function notifyNewComment(comment, linkTo, userId) {
  if (!comment) throw new Error('comment required');
  return createNotification({
    userId,
    type: 'comment',
    title: 'New comment',
    description: `A new comment was posted${comment.type ? ` on ${comment.type}` : ''}`,
    linkTo: linkTo || '#',
  });
}

function capitalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getPaymentPeriodMonths(paymentPeriod) {
  const normalized = String(paymentPeriod || 'Monthly').trim();
  const lowerCase = normalized.toLowerCase();

  if (lowerCase === 'yearly') return 12;
  if (lowerCase === '6 months' || lowerCase === '6months') return 6;
  if (lowerCase === '3 months' || lowerCase === '3months') return 3;
  return 1;
}

function calculateNextPaymentDate({ lastPaymentDate, paymentPeriod, startDate, expectedFundsDate } = {}) {
  const explicitDate = expectedFundsDate ? new Date(expectedFundsDate) : null;
  if (explicitDate && !Number.isNaN(explicitDate.getTime())) {
    const latestKnownDate = lastPaymentDate ? new Date(lastPaymentDate) : null;
    if (!latestKnownDate || explicitDate >= latestKnownDate) {
      return explicitDate;
    }
  }

  const rawBaseDate = lastPaymentDate || startDate || new Date();
  const baseDate = new Date(rawBaseDate);

  if (Number.isNaN(baseDate.getTime())) {
    return new Date();
  }

  const months = getPaymentPeriodMonths(paymentPeriod);
  const nextDate = new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth() + months,
    baseDate.getUTCDate(),
  ));

  return nextDate;
}

function getSponsorReminderStatus({ nextPaymentDate, referenceDate = new Date(), dueWindowDays = 7 }) {
  const dueDate = startOfDay(new Date(nextPaymentDate));
  const currentDate = startOfDay(new Date(referenceDate));
  const diffInDays = differenceInCalendarDays(dueDate, currentDate);

  if (diffInDays < 0) {
    return { status: 'overdue', label: 'overdue', isDue: true };
  }

  if (diffInDays === 0) {
    return { status: 'due_today', label: 'due today', isDue: true };
  }

  if (diffInDays <= dueWindowDays) {
    return { status: 'due_soon', label: `due in ${diffInDays} day${diffInDays === 1 ? '' : 's'}`, isDue: true };
  }

  return { status: 'scheduled', label: `due in ${diffInDays} days`, isDue: false };
}

function getUtcCalendarDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getSponsorEmailReminderStage({ nextPaymentDate, referenceDate = new Date() } = {}) {
  if (!nextPaymentDate || Number.isNaN(new Date(nextPaymentDate).getTime())) {
    return null;
  }

  const daysUntilDue = Math.round(
    (getUtcCalendarDay(nextPaymentDate) - getUtcCalendarDay(referenceDate)) /
      86400000,
  );

  if (daysUntilDue === 7) return '7_days_before';
  if (daysUntilDue === 0) return 'due_date';
  if (daysUntilDue === -1) return 'first_overdue_day';
  return null;
}

function getSponsorPaymentSchedule({ lastPaymentDate, paymentPeriod, startDate, expectedFundsDate, referenceDate = new Date() } = {}) {
  const baseDate = lastPaymentDate ? new Date(lastPaymentDate) : startDate ? new Date(startDate) : new Date();

  if (Number.isNaN(baseDate.getTime())) {
    return {
      lastPaymentDate: null,
      nextPaymentDate: null,
      status: 'scheduled',
      label: 'No payment date set',
      isDue: false,
      diffInDays: null,
    };
  }

  const nextPaymentDate = calculateNextPaymentDate({
    lastPaymentDate: baseDate,
    paymentPeriod,
    startDate,
    expectedFundsDate,
  });
  const reminderState = getSponsorReminderStatus({
    nextPaymentDate,
    referenceDate,
    dueWindowDays: 7,
  });

  return {
    lastPaymentDate: baseDate,
    nextPaymentDate,
    status: reminderState.status,
    label: reminderState.label,
    isDue: reminderState.isDue,
    diffInDays: differenceInCalendarDays(
      startOfDay(new Date(nextPaymentDate)),
      startOfDay(new Date(referenceDate)),
    ),
  };
}

function buildSponsorReminderNotification({
  sponsor,
  nextPaymentDate,
  paymentPeriod,
  status,
  amount,
}) {
  const donorName = sponsor?.profile?.fullName || sponsor?.sponsor?.name || sponsor?.email || 'A sponsor';
  const dueDate = new Date(nextPaymentDate);
  const formattedDate = dueDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const normalizedAmount = Number(amount || sponsor?.donation?.amount || sponsor?.amount || 0);
  const reminderTitle = status === 'overdue'
    ? 'Sponsor payment overdue'
    : status === 'due_today'
      ? 'Sponsor payment due today'
      : 'Sponsor payment due soon';
  const description = status === 'overdue'
    ? `${donorName}'s ${paymentPeriod || 'monthly'} payment of $${normalizedAmount.toFixed(2)} was due on ${formattedDate}.`
    : `${donorName}'s ${paymentPeriod || 'monthly'} payment of $${normalizedAmount.toFixed(2)} is ${status === 'due_today' ? 'due today' : 'due soon'} (${formattedDate}).`;

  return {
    type: 'sponsor_due_reminder',
    title: reminderTitle,
    description,
    linkTo: '/dashboard/sponsorships',
    relatedEntityType: 'sponsor',
    relatedEntityId: String(sponsor?._id || ''),
    nextPaymentDate: dueDate.toISOString(),
  };
}

async function generateSponsorDueReminders({
  sponsors = [],
  userIds = [],
  referenceDate = new Date(),
  dueWindowDays = 7,
} = {}) {
  if (!Array.isArray(sponsors) || sponsors.length === 0 || !Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  const notifications = [];

  for (const sponsor of sponsors) {
    const sponsorId = sponsor?._id || sponsor?.donor?._id || sponsor?.donor || null;
    if (!sponsorId) continue;

    const paymentPeriod = sponsor?.paymentPeriod || sponsor?.donation?.period || sponsor?.frequency || 'Monthly';
    const lastPaymentDate = sponsor?.lastPaymentDate || sponsor?.lastPayment || sponsor?.startDate || sponsor?.createdAt || new Date();
    const nextPaymentDate = calculateNextPaymentDate({
      lastPaymentDate,
      paymentPeriod,
      startDate: sponsor?.startDate,
      expectedFundsDate: sponsor?.expectedFundsDate || sponsor?.donation?.expectedFundsDate,
    });
    const reminderState = getSponsorReminderStatus({
      nextPaymentDate,
      referenceDate,
      dueWindowDays,
    });

    if (!reminderState.isDue) continue;

    const reminderPayload = buildSponsorReminderNotification({
      sponsor,
      nextPaymentDate,
      paymentPeriod,
      status: reminderState.status,
      amount: sponsor?.donation?.amount || sponsor?.amount,
    });

    for (const userId of userIds) {
      const existingNotification = await Notification.findOne({
        userId,
        type: 'sponsor_due_reminder',
        relatedEntityType: 'sponsor',
        relatedEntityId: String(sponsorId),
        scheduledFor: nextPaymentDate,
        status: { $in: ['unread', 'read', 'archived'] },
      });

      if (existingNotification) {
        continue;
      }

      const createdNotification = await createNotification({
        userId,
        type: reminderPayload.type,
        title: reminderPayload.title,
        description: reminderPayload.description,
        linkTo: reminderPayload.linkTo,
        scheduledFor: nextPaymentDate,
        relatedEntityType: reminderPayload.relatedEntityType,
        relatedEntityId: reminderPayload.relatedEntityId,
      });

      notifications.push(createdNotification);
    }
  }

  return notifications;
}

async function markAsRead(id, userId) {
  return Notification.findOneAndUpdate(
    { _id: id, userId },
    {
      status: 'read',
      seen: true,
      readAt: new Date(),
    },
    { new: true },
  );
}

async function archiveNotification(id, userId) {
  return Notification.findOneAndUpdate(
    { _id: id, userId },
    {
      status: 'archived',
      seen: true,
      archivedAt: new Date(),
    },
    { new: true },
  );
}

async function deleteNotification(id, userId) {
  return Notification.findOneAndUpdate(
    { _id: id, userId },
    {
      status: 'deleted',
      seen: true,
      deletedAt: new Date(),
    },
    { new: true },
  );
}

async function getNotifications(filter = {}) {
  const query = Notification.find({ userId: filter.userId, status: { $ne: 'deleted' } });

  if (filter.status) {
    query.where('status').equals(filter.status);
  }

  if (filter.type) {
    query.where('type').equals(filter.type);
  }

  if (filter.since) {
    query.where('createdAt').gte(new Date(filter.since));
  }

  if (filter.skip) query.skip(filter.skip);
  if (filter.limit) query.limit(filter.limit);

  const [items, total] = await Promise.all([
    query.sort({ createdAt: -1, _id: -1 }).exec(),
    Notification.countDocuments({
      userId: filter.userId,
      ...(filter.status ? { status: filter.status } : { status: { $ne: 'deleted' } }),
      ...(filter.type ? { type: filter.type } : {}),
    }),
  ]);

  return filter.withMeta ? { items, total } : items;
}

async function getUnreadCount(userId) {
  return Notification.countDocuments({
    userId,
    status: 'unread',
  });
}

function markAsSeen(id, userId) {
  return markAsRead(id, userId);
}

function clearAll() {
  return Notification.deleteMany({});
}

module.exports = {
  createNotification,
  createNotificationForUsers,
  markAsSeen,
  markAsRead,
  archiveNotification,
  deleteNotification,
  getNotifications,
  getUnreadCount,
  notifySystem,
  notifyResourceCreated,
  notifyResourceUpdated,
  notifyResourceDeleted,
  notifyNewComment,
  notifyNewMessage,
  notifyNewsletterSubscription,
  notifyBlogLike,
  notifyBlogShare,
  calculateNextPaymentDate,
  getSponsorReminderStatus,
  getSponsorEmailReminderStage,
  getSponsorPaymentSchedule,
  buildSponsorReminderNotification,
  generateSponsorDueReminders,
};
