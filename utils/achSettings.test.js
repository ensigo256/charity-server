const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSettings, publicSettings } = require("../controllers/achSettingsController");

test("accepts ACH contact settings without bank credentials", () => {
  assert.deepEqual(
    validateSettings({
      recipientEmail: " ACH-PAYMENTS@EXAMPLE.ORG ",
      sponsorMessage: "Please contact {recipientEmail} to begin payment.",
    }),
    {
      recipientEmail: "ach-payments@example.org",
      sponsorMessage: "Please contact {recipientEmail} to begin payment.",
    },
  );
});

test("rejects invalid ACH contact email", () => {
  assert.throws(
    () =>
      validateSettings({
        recipientEmail: "not-an-email",
        sponsorMessage: "Please begin payment.",
      }),
    /valid ACH recipient email/,
  );
});

test("public ACH settings omit legacy bank credentials", () => {
  assert.deepEqual(
    publicSettings({
      recipientEmail: "ach@example.org",
      sponsorMessage: "Contact us.",
      routingNumber: "123456789",
      accountNumber: "987654321",
    }),
    {
      configured: true,
      recipientEmail: "ach@example.org",
      sponsorMessage: "Contact us.",
    },
  );
});
