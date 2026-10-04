const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildNewsletterWelcomeHtml,
  buildSponsorReminderEmail,
  sendEmail,
} = require("../utils/mail");

test("HTML email templates reference the shared inline organization logo", () => {
  const sponsorReminder = buildSponsorReminderEmail({
    dueDate: "2026-10-20T00:00:00.000Z",
    sponsorships: [],
  });
  const newsletter = buildNewsletterWelcomeHtml("Amina", "amina@example.com", "verify", "unsubscribe");

  assert.match(sponsorReminder.html, /src="cid:org-logo"/);
  assert.match(newsletter, /src="cid:org-logo"/);
});

test("email delivery uses Resend when it succeeds", async () => {
  const originalFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = "Foundation <mail@example.com>";
  let smtpCalls = 0;
  const result = await sendEmail(
    {
      to: "person@example.com",
      subject: "Hello",
      text: "Message",
      attachments: [{ filename: "dark-logo.jpeg", content: Buffer.from("image"), cid: "org-logo" }],
    },
    {
      resendClient: {
        emails: {
          send: async (message) => {
            assert.equal(message.attachments[0].contentId, "org-logo");
            return { data: { id: "email-id" } };
          },
        },
      },
      transporterFactory: () => ({ sendMail: async () => { smtpCalls += 1; } }),
    },
  );
  process.env.MAIL_FROM = originalFrom;

  assert.deepEqual(result, { sent: true, provider: "resend" });
  assert.equal(smtpCalls, 0);
});

test("email delivery falls back to Nodemailer when Resend returns an error", async () => {
  const originalFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = "Foundation <mail@example.com>";
  let smtpMessage;
  const result = await sendEmail(
    {
      to: "person@example.com",
      subject: "Hello",
      text: "Message",
      attachments: [{ filename: "dark-logo.jpeg", content: Buffer.from("image"), cid: "org-logo" }],
    },
    {
      resendClient: { emails: { send: async () => ({ error: new Error("Resend unavailable") }) } },
      transporterFactory: () => ({ sendMail: async (message) => { smtpMessage = message; } }),
    },
  );
  process.env.MAIL_FROM = originalFrom;

  assert.deepEqual(result, { sent: true, provider: "nodemailer", fallback: true });
  assert.equal(smtpMessage.to, "person@example.com");
  assert.equal(smtpMessage.from, "Foundation <mail@example.com>");
  assert.equal(smtpMessage.attachments[0].cid, "org-logo");
  assert.equal("contentId" in smtpMessage.attachments[0], false);
});

test("email delivery falls back to Nodemailer when Resend throws", async () => {
  const originalFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = "Foundation <mail@example.com>";
  let smtpCalls = 0;
  const result = await sendEmail(
    { to: "person@example.com", subject: "Hello", text: "Message" },
    {
      resendClient: { emails: { send: async () => { throw new Error("Network failure"); } } },
      transporterFactory: () => ({ sendMail: async () => { smtpCalls += 1; } }),
    },
  );
  process.env.MAIL_FROM = originalFrom;

  assert.deepEqual(result, { sent: true, provider: "nodemailer", fallback: true });
  assert.equal(smtpCalls, 1);
});