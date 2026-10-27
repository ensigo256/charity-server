const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePaymentLinkUrl,
  validateAdminAlertEmail,
} = require("./stripePaymentLinkSettingsController");

test("accepts HTTPS Payment Links from Stripe's hosted domains", () => {
  assert.equal(
    validatePaymentLinkUrl("https://buy.stripe.com/test_abc"),
    "https://buy.stripe.com/test_abc",
  );
  assert.equal(
    validatePaymentLinkUrl("https://donate.stripe.com/test_abc"),
    "https://donate.stripe.com/test_abc",
  );
});

test("rejects non-Stripe and unsafe Payment Link URLs", () => {
  for (const value of [
    "http://buy.stripe.com/test_abc",
    "https://stripe.com/checkout",
    "https://buy.stripe.com.evil.example/link",
    "https://user:pass@buy.stripe.com/link",
    "https://buy.stripe.com/link#fragment",
  ]) {
    assert.throws(() => validatePaymentLinkUrl(value), { statusCode: 400 });
  }
});

test("normalizes valid payment-attempt alert email", () => {
  assert.equal(
    validateAdminAlertEmail(" Info@EnsigoOfLove.org "),
    "info@ensigooflove.org",
  );
});

test("rejects malformed or oversized payment-attempt alert email", () => {
  assert.throws(() => validateAdminAlertEmail("not-an-email"), {
    statusCode: 400,
  });
  assert.throws(() => validateAdminAlertEmail(`${"a".repeat(250)}@x.co`), {
    statusCode: 400,
  });
});
