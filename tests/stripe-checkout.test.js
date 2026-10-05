const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildStripeCheckoutSessionData } = require("../utils/stripeCheckout");

test("buildStripeCheckoutSessionData creates a valid one-time checkout payload", () => {
  const sessionData = buildStripeCheckoutSessionData({
    childId: "507f1f77bcf86cd799439011",
    childName: "Amina Kato",
    sponsor: {
      name: "Jane Sponsor",
      email: "jane@example.com",
      phone: "+15551234567",
    },
    donation: {
      amount: 50,
      period: "Monthly",
    },
    successUrl: "http://localhost:3000/stripe/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "http://localhost:3000/stripe/cancel",
  });

  assert.equal(sessionData.mode, "payment");
  assert.equal(sessionData.line_items.length, 1);
  assert.equal(sessionData.line_items[0].price_data.unit_amount, 5000);
  assert.equal(sessionData.line_items[0].quantity, 1);
  assert.equal(sessionData.metadata.childId, "507f1f77bcf86cd799439011");
  assert.equal(sessionData.metadata.childName, "Amina Kato");
  assert.equal(sessionData.customer_email, "jane@example.com");
  assert.equal(sessionData.success_url.includes("CHECKOUT_SESSION_ID"), true);
});

test("buildStripeCheckoutSessionData rejects invalid donation values", () => {
  assert.throws(() => {
    buildStripeCheckoutSessionData({
      childId: "507f1f77bcf86cd799439011",
      sponsor: { name: "Jane Sponsor", email: "jane@example.com" },
      donation: { amount: 0, period: "Monthly" },
      successUrl: "http://localhost:3000/stripe/success",
      cancelUrl: "http://localhost:3000/stripe/cancel",
    });
  }, /amount/i);
});
