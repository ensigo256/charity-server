const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateAchReceipt } = require("./achReceipt");

test("keeps a partially funded ACH pledge pending", () => {
  assert.deepEqual(
    calculateAchReceipt({
      pledgedAmount: 100,
      totalPaid: 25.25,
      receivedAmount: 24.75,
    }),
    { totalPaid: 50, remaining: 50, fullyFunded: false },
  );
});

test("marks an exactly funded ACH pledge as fully funded", () => {
  assert.deepEqual(
    calculateAchReceipt({
      pledgedAmount: 100,
      totalPaid: 50,
      receivedAmount: 50,
    }),
    { totalPaid: 100, remaining: 0, fullyFunded: true },
  );
});

test("rejects overpayment without changing the pledge", () => {
  assert.throws(
    () =>
      calculateAchReceipt({
        pledgedAmount: 100,
        totalPaid: 75,
        receivedAmount: 25.01,
      }),
    (error) =>
      error.code === "ACH_OVERPAYMENT" &&
      error.statusCode === 409 &&
      error.message.includes("remaining pledge of 25.00"),
  );
});

test("rejects nonpositive or nonfinite receipt amounts", () => {
  for (const receivedAmount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() =>
      calculateAchReceipt({
        pledgedAmount: 100,
        totalPaid: 0,
        receivedAmount,
      }),
    );
  }
});
