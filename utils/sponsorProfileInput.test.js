const test = require("node:test");
const assert = require("node:assert/strict");
const { pickEditableDonationFields } = require("./sponsorProfileInput");

test("preserves donation settings used by the dashboard editor", () => {
  assert.deepEqual(
    pickEditableDonationFields({
      amount: 50,
      period: "Monthly",
      expectedFundsDate: "2026-11-01",
      remindByEmail: true,
    }),
    {
      amount: 50,
      period: "Monthly",
      expectedFundsDate: "2026-11-01",
      remindByEmail: true,
    },
  );
});

test("drops unrelated nested donation properties", () => {
  assert.deepEqual(
    pickEditableDonationFields({
      amount: 50,
      period: "Monthly",
      paymentMethod: "stripe",
      status: "Active",
      totalPaid: 999999,
    }),
    { amount: 50, period: "Monthly" },
  );
});