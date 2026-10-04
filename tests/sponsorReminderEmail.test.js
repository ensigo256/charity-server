const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSponsorReminderEmail } = require("../utils/mail");
const {
  buildDeliveryCandidate,
  isSponsorReminderEnabled,
} = require("../utils/sponsorReminderService");

test("sponsor reminder email includes the due date and sponsorship summary in both formats", () => {
  const email = buildSponsorReminderEmail({
    name: "Amina Patel",
    dueDate: "2026-10-20T00:00:00.000Z",
    stage: "7_days_before",
    sponsorships: [
      {
        amount: 120,
        currency: "USD",
        frequency: "Monthly",
        children: ["Sam Kato"],
      },
    ],
  });

  assert.match(email.subject, /upcoming sponsorship payment/i);
  assert.match(email.html, /Amina Patel/);
  assert.match(email.html, /October 20, 2026/);
  assert.match(email.html, /USD 120/);
  assert.match(email.html, /Sam Kato/);
  assert.match(email.text, /October 20, 2026/);
  assert.match(email.text, /USD 120/);
});

test("sponsor reminder email escapes dynamic HTML content", () => {
  const email = buildSponsorReminderEmail({
    name: '<img src=x onerror="alert(1)">',
    dueDate: "2026-10-20T00:00:00.000Z",
    stage: "due_date",
    sponsorships: [
      { amount: 5, currency: "USD", frequency: "Monthly", children: ["<script>bad</script>"] },
    ],
  });

  assert.doesNotMatch(email.html, /<img src=x/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;bad&lt;\/script&gt;/);
});

test("sponsor reminder preference defaults on but explicit opt-out blocks eligibility", () => {
  assert.equal(isSponsorReminderEnabled({ donation: {} }), true);
  assert.equal(isSponsorReminderEnabled({ donation: { remindByEmail: false } }), false);

  const sponsorship = {
    _id: "67f0c3d14f1a8a3f9d4b0c21",
    donor: {
      _id: "67f0c3d14f1a8a3f9d4b0c11",
      profile: { fullName: "Amina Patel", email: "amina@example.com" },
      donation: { amount: 120, period: "Monthly", remindByEmail: false },
    },
    frequency: "Monthly",
    startDate: "2026-09-20T00:00:00.000Z",
    lastPayment: "2026-09-20T00:00:00.000Z",
    payments: [],
  };

  assert.equal(
    buildDeliveryCandidate(sponsorship, new Date("2026-10-13T00:00:00.000Z")),
    null,
  );
});

test("sponsor delivery candidate uses the expected funds date override", () => {
  const sponsorship = {
    _id: "67f0c3d14f1a8a3f9d4b0c21",
    donor: {
      _id: "67f0c3d14f1a8a3f9d4b0c11",
      profile: { fullName: "Amina Patel", email: "amina@example.com" },
      donation: {
        amount: 120,
        period: "Monthly",
        expectedFundsDate: "2026-10-20T00:00:00.000Z",
      },
    },
    frequency: "Monthly",
    startDate: "2026-09-20T00:00:00.000Z",
    lastPayment: "2026-09-20T00:00:00.000Z",
    payments: [],
    expectedFundsDate: null,
    child: { firstName: "Sam", secondName: "Kato" },
  };

  const candidate = buildDeliveryCandidate(
    sponsorship,
    new Date("2026-10-13T00:00:00.000Z"),
  );

  assert.equal(candidate.dueDateKey, "2026-10-20");
  assert.equal(candidate.stage, "7_days_before");
  assert.equal(candidate.payload.sponsorships[0].children[0], "Sam Kato");
});