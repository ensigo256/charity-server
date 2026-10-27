const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getExpectedStripeAmount,
  getRemainingStripeAmount,
  isStripeOverpayment,
} = require("./stripePaymentAttempt");
const { getCurrentDueDateKey } = require("./stripePaymentPage");

test("pending pledge payment page shows the remaining amount", () => {
  assert.equal(
    getExpectedStripeAmount(
      { status: "Pending", amount: 100, totalPaid: 35.25 },
      100,
    ),
    64.75,
  );
});

test("active pledge payment page uses the scheduled one-time installment", () => {
  assert.equal(
    getExpectedStripeAmount(
      { status: "Active", amount: 100, totalPaid: 150 },
      100,
    ),
    100,
  );
});

test("blocks overpayments using cent precision", () => {
  assert.equal(isStripeOverpayment(25, 25), false);
  assert.equal(isStripeOverpayment(25.01, 25), true);
  assert.equal(isStripeOverpayment(25.004, 25), false);
});

test("subtracts verified partial payments from one installment", () => {
  assert.equal(getRemainingStripeAmount(50, [12.5, 7.25]), 30.25);
  assert.equal(getRemainingStripeAmount(50, [20, 35]), 0);
});

test("payment pages follow the current completed-payment due date", () => {
  const sponsorship = {
    startDate: new Date("2024-01-15T00:00:00.000Z"),
    frequency: "Monthly",
    payments: [
      { status: "Completed", date: new Date("2024-01-15T00:00:00.000Z") },
    ],
  };
  assert.equal(getCurrentDueDateKey(sponsorship), "2024-02-15");

  sponsorship.payments.push({
    status: "Completed",
    date: new Date("2024-02-01T00:00:00.000Z"),
  });
  assert.equal(getCurrentDueDateKey(sponsorship), "2024-03-01");
});

test("rejects invalid expected amounts", () => {
  assert.throws(() =>
    getExpectedStripeAmount({ status: "Active" }, Number.NaN),
  );
});
