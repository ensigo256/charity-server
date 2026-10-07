const test = require("node:test");
const assert = require("node:assert/strict");
const { getStripeSessionValidationError } = require("./stripePaymentValidation");

const sponsorship = {
  _id: "sponsorship-1",
  donor: "sponsor-1",
  child: "child-1",
  amount: 25,
  currency: "USD",
};

const paidSession = {
  id: "cs_test_123",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  amount_total: 2500,
  metadata: {
    sponsorshipId: "sponsorship-1",
    sponsorId: "sponsor-1",
    childId: "child-1",
  },
};

test("accepts a paid Checkout session matching the pledge", () => {
  assert.equal(getStripeSessionValidationError(paidSession, sponsorship), null);
});

test("rejects completed sessions that are not paid", () => {
  assert.match(
    getStripeSessionValidationError(
      { ...paidSession, payment_status: "unpaid" },
      sponsorship,
    ),
    /not paid and complete/,
  );
});

test("rejects amounts or currencies that do not match the pledge", () => {
  assert.match(
    getStripeSessionValidationError(
      { ...paidSession, amount_total: 2400 },
      sponsorship,
    ),
    /amount does not match/,
  );
  assert.match(
    getStripeSessionValidationError(
      { ...paidSession, currency: "eur" },
      sponsorship,
    ),
    /currency does not match/,
  );
});

test("rejects sessions whose metadata points to another pledge", () => {
  assert.match(
    getStripeSessionValidationError(
      { ...paidSession, metadata: { ...paidSession.metadata, childId: "child-2" } },
      sponsorship,
    ),
    /metadata does not match/,
  );
});