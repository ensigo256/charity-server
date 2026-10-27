const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeManualPaymentInput } = require("./manualPaymentInput");

test("normalizes a valid manual payment", () => {
  assert.deepEqual(
    normalizeManualPaymentInput({
      amount: "25.5",
      method: "ACH",
      transactionId: " BANK-REF-1 ",
      notes: "  Monthly support  ",
    }),
    {
      amount: 25.5,
      method: "ACH",
      transactionId: "BANK-REF-1",
      notes: "Monthly support",
    },
  );
});

test("rejects nonpositive, excessive, or nonfinite amounts", () => {
  for (const amount of [0, -1, "NaN", "Infinity", 1000001]) {
    assert.throws(
      () => normalizeManualPaymentInput({ amount, method: "ACH", transactionId: "ref" }),
      /Payment amount/,
    );
  }
});

test("rejects unsupported methods, missing references, and oversized notes", () => {
  assert.throws(
    () => normalizeManualPaymentInput({ amount: 10, method: "Wire Crypto", transactionId: "ref" }),
    /payment method/,
  );
  for (const method of ["Cash", "Bank Transfer", "Mobile Money", "PayPal", "Zelle", "Stripe", "Check", "Other"]) {
    assert.throws(
      () => normalizeManualPaymentInput({ amount: 10, method, transactionId: "ref" }),
      /payment method/,
    );
  }
  assert.throws(
    () => normalizeManualPaymentInput({ amount: 10, method: "ACH" }),
    /Transaction reference/,
  );
  assert.throws(
    () => normalizeManualPaymentInput({ amount: 10, method: "ACH", transactionId: "ref", notes: "x".repeat(1001) }),
    /Payment notes/,
  );
});