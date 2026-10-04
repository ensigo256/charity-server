const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const notificationUtil = require("../utils/notificationUtil");
const Notification = require("../models/notification");

const originalMethods = new Map();

function replace(object, name, implementation) {
  const key = `${object.modelName || object.name}.${name}`;
  if (!originalMethods.has(key)) {
    originalMethods.set(key, [object, name, object[name]]);
  }
  object[name] = implementation;
}

afterEach(() => {
  for (const [object, name, original] of originalMethods.values()) object[name] = original;
  originalMethods.clear();
});

test("notifications can be created per user and counted unread for the active user only", async () => {
  const userOne = "507f1f77bcf86cd799439011";
  const userTwo = "507f1f77bcf86cd799439012";

  replace(Notification, "create", async (doc) => ({ ...doc, _id: "n1" }));

  const notifications = await notificationUtil.createNotificationForUsers({
    userIds: [userOne, userTwo],
    type: "sponsor_due_reminder",
    title: "Sponsor payment due soon",
    description: "A sponsor payment is due in 7 days.",
    linkTo: "/dashboard/sponsorships",
  });

  assert.equal(Array.isArray(notifications), true);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].userId, userOne);
  assert.equal(notifications[1].userId, userTwo);
  assert.equal(notifications[0].status, "unread");

  let count = 0;
  replace(Notification, "countDocuments", async (query) => {
    count = query.userId.toString() === userOne ? 2 : 1;
    return count;
  });

  const unreadCount = await notificationUtil.getUnreadCount(userOne);
  assert.equal(unreadCount, 2);
});

test("marking a notification as read only updates the current user instance", async () => {
  const userOne = "507f1f77bcf86cd799439011";
  let updatedDoc = null;
  replace(Notification, "findOneAndUpdate", async (query, update) => {
    updatedDoc = { ...query, ...update };
    return { _id: "n1", userId: userOne, status: "read" };
  });

  const updated = await notificationUtil.markAsRead("n1", userOne);
  assert.equal(updated.status, "read");
  assert.equal(updatedDoc.userId, userOne);
  assert.equal(updatedDoc.status, "read");
});

test("notification listing filters only to the current user", async () => {
  const userOne = "507f1f77bcf86cd799439011";
  const userTwo = "507f1f77bcf86cd799439012";
  const documents = [
    { _id: "n1", userId: userOne, status: "unread", type: "message" },
    { _id: "n2", userId: userTwo, status: "unread", type: "message" },
  ];

  replace(Notification, "find", () => ({
    where(field) {
      return this;
    },
    equals(value) {
      return this;
    },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    exec: async () => documents.filter((item) => item.userId === userOne),
  }));

  replace(Notification, "countDocuments", async (query) => {
    return documents.filter((item) => item.userId === userOne && item.status === query.status).length;
  });

  const results = await notificationUtil.getNotifications({ userId: userOne, status: "unread" });
  assert.equal(results.length, 1);
  assert.equal(results[0].userId, userOne);
});

test("next payment date is derived from the latest payment date and the sponsor period", () => {
  const lastPaymentDate = new Date("2026-01-15T00:00:00.000Z");
  const nextPaymentDate = notificationUtil.calculateNextPaymentDate({
    lastPaymentDate,
    paymentPeriod: "Monthly",
  });

  assert.equal(nextPaymentDate.toISOString().slice(0, 10), "2026-02-15");
});

test("an explicit expected funds date overrides the fallback payment-period calculation", () => {
  const nextPaymentDate = notificationUtil.calculateNextPaymentDate({
    lastPaymentDate: new Date("2026-01-15T00:00:00.000Z"),
    paymentPeriod: "Monthly",
    expectedFundsDate: new Date("2026-02-20T00:00:00.000Z"),
  });

  assert.equal(nextPaymentDate.toISOString().slice(0, 10), "2026-02-20");
});

test("sponsor email reminders are staged at seven days, due date, and first overdue day", () => {
  const dueDate = new Date("2026-10-20T00:00:00.000Z");

  assert.equal(
    notificationUtil.getSponsorEmailReminderStage({
      nextPaymentDate: dueDate,
      referenceDate: new Date("2026-10-13T00:00:00.000Z"),
    }),
    "7_days_before",
  );
  assert.equal(
    notificationUtil.getSponsorEmailReminderStage({
      nextPaymentDate: dueDate,
      referenceDate: dueDate,
    }),
    "due_date",
  );
  assert.equal(
    notificationUtil.getSponsorEmailReminderStage({
      nextPaymentDate: dueDate,
      referenceDate: new Date("2026-10-21T00:00:00.000Z"),
    }),
    "first_overdue_day",
  );
});

test("sponsor email reminders do not repeat on intervening or later overdue days", () => {
  const nextPaymentDate = new Date("2026-10-20T00:00:00.000Z");

  for (const referenceDate of [
    new Date("2026-10-12T00:00:00.000Z"),
    new Date("2026-10-14T00:00:00.000Z"),
    new Date("2026-10-19T00:00:00.000Z"),
    new Date("2026-10-22T00:00:00.000Z"),
  ]) {
    assert.equal(
      notificationUtil.getSponsorEmailReminderStage({
        nextPaymentDate,
        referenceDate,
      }),
      null,
    );
  }
});

test("payment schedule summary tracks the last and next expected sponsor payments", () => {
  const schedule = notificationUtil.getSponsorPaymentSchedule({
    lastPaymentDate: new Date("2026-03-15T00:00:00.000Z"),
    paymentPeriod: "Monthly",
    startDate: new Date("2026-02-15T00:00:00.000Z"),
    referenceDate: new Date("2026-04-10T00:00:00.000Z"),
  });

  assert.equal(schedule.lastPaymentDate.toISOString().slice(0, 10), "2026-03-15");
  assert.equal(schedule.nextPaymentDate.toISOString().slice(0, 10), "2026-04-15");
  assert.equal(schedule.status, "due_soon");
});

test("sponsor reminder notifications include the correct reminder message and metadata", () => {
  const sponsor = {
    _id: "67f0c3d14f1a8a3f9d4b0c11",
    profile: { fullName: "Amina Patel" },
    donation: { amount: 120, period: "Monthly" },
    email: "amina@example.com",
  };

  const reminder = notificationUtil.buildSponsorReminderNotification({
    sponsor,
    nextPaymentDate: new Date("2026-02-15T00:00:00.000Z"),
    paymentPeriod: "Monthly",
    status: "due_soon",
  });

  assert.equal(reminder.type, "sponsor_due_reminder");
  assert.match(reminder.title, /due soon|due today|overdue/i);
  assert.match(reminder.description, /Amina Patel/i);
  assert.equal(reminder.linkTo, "/dashboard/sponsorships");
});

test("newsletter signups create a notification for active admins", async () => {
  const userIds = ["507f1f77bcf86cd799439011"];
  const subscriber = { _id: "67f0d3b4d961a49c5c6b8e91", email: "new@example.com", name: "New Subscriber" };

  replace(Notification, "create", async (doc) => ({ ...doc, _id: "n-newsletter" }));

  const created = await notificationUtil.notifyNewsletterSubscription({
    subscriber,
    userIds,
  });

  assert.equal(created[0].type, "newsletter");
  assert.match(created[0].title, /newsletter/i);
  assert.match(created[0].description, /New Subscriber|new@example.com/i);
});

test("blog likes and shares create admin-facing reaction notifications", async () => {
  const userIds = ["507f1f77bcf86cd799439011"];

  replace(Notification, "create", async (doc) => ({ ...doc, _id: `n-${Math.random().toString(16).slice(2)}` }));

  const likeNotification = await notificationUtil.notifyBlogLike({
    blog: { _id: "67f0d3b4d961a49c5c6b8e92", title: "Impact update" },
    userIds,
    actorName: "Sarah",
  });

  const shareNotification = await notificationUtil.notifyBlogShare({
    blog: { _id: "67f0d3b4d961a49c5c6b8e92", title: "Impact update" },
    userIds,
    actorName: "Sarah",
  });

  assert.equal(likeNotification[0].type, "blog_like");
  assert.equal(shareNotification[0].type, "blog_share");
  assert.match(likeNotification[0].description, /like|liked/i);
  assert.match(shareNotification[0].description, /share|shared/i);
});
