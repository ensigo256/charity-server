const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAchInstructionsEmail } = require("./mail");

test("ACH sponsor email uses contact settings and hides bank credentials", () => {
  const message = buildAchInstructionsEmail({
    name: "Jordan",
    pledge: {
      reference: "ACH-TEST",
      amount: 50,
      currency: "USD",
      period: "Monthly",
    },
    settings: {
      recipientEmail: "ach@example.org",
      sponsorMessage: "Thank you. Please contact {recipientEmail} to begin.",
      routingNumber: "123456789",
      accountNumber: "987654321",
    },
  });

  assert.match(message.subject, /ACH sponsorship payment instructions/i);
  assert.match(message.html, /ach@example\.org/);
  assert.match(message.text, /ACH-TEST/);
  assert.doesNotMatch(message.html, /123456789|987654321|routing number/i);
  assert.doesNotMatch(message.text, /123456789|987654321|routing number/i);
});
