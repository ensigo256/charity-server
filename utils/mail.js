const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const fs = require("node:fs");
const path = require("node:path");

const EMAIL_LOGO_PATH = path.join(__dirname, "../public/dark-logo.jpeg");

function getLogoAttachment() {
  return {
    filename: "dark-logo.jpeg",
    content: fs.readFileSync(EMAIL_LOGO_PATH),
    contentType: "image/jpeg",
    cid: "org-logo",
  };
}

function getResendClient() {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_PORT) === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail(message, {
  resendClient = getResendClient(),
  transporterFactory = getTransporter,
} = {}) {
  if (!process.env.MAIL_FROM) {
    throw new Error("MAIL_FROM is required");
  }

  const email = { ...message, from: process.env.MAIL_FROM };
  const formatAttachments = (provider) =>
    email.attachments?.map(({ cid, ...attachment }) => ({
      ...attachment,
      [provider === "resend" ? "contentId" : "cid"]: cid,
    }));

  if (resendClient) {
    try {
      const resendEmail = {
        ...email,
        ...(email.attachments && { attachments: formatAttachments("resend") }),
      };
      const { error } = await resendClient.emails.send(resendEmail);
      if (error) throw error;
      return { sent: true, provider: "resend" };
    } catch (resendError) {
      const transporter = transporterFactory();
      if (!transporter) {
        throw new Error("Resend delivery failed and SMTP fallback is not configured", {
          cause: resendError,
        });
      }

      try {
        const smtpEmail = {
          ...email,
          ...(email.attachments && { attachments: formatAttachments("nodemailer") }),
        };
        await transporter.sendMail(smtpEmail);
      } catch (smtpError) {
        throw new AggregateError(
          [resendError, smtpError],
          "Email delivery failed through Resend and SMTP",
        );
      }
      return { sent: true, provider: "nodemailer", fallback: true };
    }
  }

  const transporter = transporterFactory();
  if (!transporter) {
    throw new Error(
      "RESEND_API_KEY or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM are required",
    );
  }
  const smtpEmail = {
    ...email,
    ...(email.attachments && { attachments: formatAttachments("nodemailer") }),
  };
  await transporter.sendMail(smtpEmail);
  return { sent: true, provider: "nodemailer" };
}

function getBrandConfig() {
  return {
    orgName: process.env.ORG_NAME || "Seeds of Love Foundation",
    orgTagline: process.env.ORG_TAGLINE || "We Rise By Lifting Others",
    facebookUrl: process.env.FACEBOOK_URL || "https://facebook.com",
    xUrl: process.env.X_URL || "https://x.com",
    tiktokUrl: process.env.TIKTOK_URL || "https://tiktok.com",
    websiteUrl:
      process.env.WEBSITE_URL || "https://www.seedsoflovefoundation.org",
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getSponsorReminderCopy(stage) {
  if (stage === "7_days_before") {
    return {
      subject: "A friendly reminder about your upcoming sponsorship payment",
      heading: "Your next sponsorship payment is coming up",
      intro:
        "This is a friendly reminder that your next sponsorship contribution is due in 7 days.",
    };
  }
  if (stage === "first_overdue_day") {
    return {
      subject: "A quick follow-up about your sponsorship payment",
      heading: "A quick follow-up",
      intro:
        "Our records show that your expected sponsorship contribution has not yet been recorded. If you have already sent it, thank you; please disregard this note or reply so we can update our records.",
    };
  }
  return {
    subject: "Your sponsorship contribution is due today",
    heading: "Your sponsorship contribution is due today",
    intro:
      "This is a friendly reminder that your next sponsorship contribution is due today.",
  };
}

function buildSponsorReminderEmail({
  name,
  dueDate,
  stage,
  sponsorships = [],
  replyTo,
} = {}) {
  const brand = getBrandConfig();
  const copy = getSponsorReminderCopy(stage);
  const safeName = escapeHtml(name || "Sponsor");
  const safeOrgName = escapeHtml(brand.orgName);
  const safeTagline = escapeHtml(brand.orgTagline);
  const formattedDate = new Date(dueDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const details = sponsorships.map((item) => {
    const amount = Number(item.amount || 0).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    });
    const currency = escapeHtml(item.currency || "USD");
    const frequency = escapeHtml(item.frequency || "sponsorship");
    const children =
      (item.children || []).map(escapeHtml).join(", ") ||
      "your sponsored child";
    return { amount, currency, frequency, children };
  });
  const rows = details
    .map(
      (item) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #e4ebe6;color:#25352d;">
        <strong style="display:block;font-size:15px;">${item.children}</strong>
        <span style="display:block;margin-top:5px;color:#63736a;font-size:13px;">${item.frequency}</span>
      </td>
      <td align="right" style="padding:14px 0;border-bottom:1px solid #e4ebe6;color:#25352d;font-size:15px;font-weight:700;white-space:nowrap;">
        ${item.currency} ${item.amount}
      </td>
    </tr>`,
    )
    .join("");
  const contact = escapeHtml(replyTo || process.env.CONTACT_RECIPIENT || "");
  const website = escapeHtml(brand.websiteUrl);
  const html = `
    <div style="margin:0;background:#f1f5f2;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#25352d;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dce6df;border-radius:10px;overflow:hidden;">
        <div style="background:#145c3a;padding:26px 30px;text-align:center;">
          <img src="cid:org-logo" width="58" height="58" alt="${safeOrgName}" style="display:block;width:58px;height:58px;object-fit:contain;margin:0 auto 12px;background:#ffffff;border-radius:8px;padding:5px;" />
          <div style="font-size:21px;line-height:1.3;font-weight:700;color:#ffffff;">${safeOrgName}</div>
          <div style="margin-top:5px;font-size:12px;color:#d7eee0;">${safeTagline}</div>
        </div>
        <div style="padding:30px;">
          <p style="margin:0 0 8px;font-size:14px;color:#63736a;">Hello ${safeName},</p>
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#174d35;">${copy.heading}</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#46564d;">${copy.intro}</p>
          <div style="padding:16px 18px;background:#f2f7f3;border-left:4px solid #27824f;border-radius:4px;margin-bottom:22px;">
            <div style="font-size:12px;text-transform:uppercase;color:#63736a;font-weight:700;">Expected date</div>
            <div style="margin-top:6px;font-size:19px;font-weight:700;color:#174d35;">${escapeHtml(formattedDate)}</div>
          </div>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <thead><tr><th align="left" style="padding:0 0 8px;color:#63736a;font-size:11px;text-transform:uppercase;">Sponsorship</th><th align="right" style="padding:0 0 8px;color:#63736a;font-size:11px;text-transform:uppercase;">Contribution</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin:0;font-size:14px;line-height:1.65;color:#46564d;">Your support makes a meaningful difference. If you have already made this contribution, thank you. For questions or to let us know about a transfer, reply to this email${contact ? ` or contact <a href="mailto:${contact}" style="color:#145c3a;">${contact}</a>` : ""}.</p>
          <p style="margin:20px 0 0;font-size:14px;color:#46564d;">With gratitude,<br /><strong>${safeOrgName}</strong></p>
        </div>
        <div style="padding:16px 30px;background:#f7f9f7;border-top:1px solid #e4ebe6;text-align:center;font-size:12px;line-height:1.6;color:#63736a;">
          <a href="${website}" style="color:#145c3a;text-decoration:underline;">${website}</a>
          <div style="margin-top:5px;">You are receiving this message because payment reminders are enabled for your sponsorship profile.</div>
        </div>
      </div>
    </div>`;
  const textDetails = details
    .map(
      (item) =>
        `- ${item.children}: ${item.currency} ${item.amount} (${item.frequency})`,
    )
    .join("\n");
  const text = [
    `Hello ${name || "Sponsor"},`,
    "",
    copy.heading,
    copy.intro,
    `Expected date: ${formattedDate}`,
    "",
    textDetails,
    "",
    "If you have already made this contribution, thank you. For questions or to let us know about a transfer, reply to this email.",
    "",
    `With gratitude,\n${brand.orgName}`,
    brand.websiteUrl,
  ].join("\n");

  return { subject: copy.subject, html, text };
}

async function sendSponsorReminderEmail({ email, ...reminder }) {
  const replyTo = process.env.CONTACT_RECIPIENT || process.env.SMTP_USER;
  const message = buildSponsorReminderEmail({ ...reminder, replyTo });

  return sendEmail({
    to: email,
    replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: [getLogoAttachment()],
  });
}

function buildNewsletterWelcomeHtml(name, email, verificationToken, unsubscribeToken) {
  const brand = getBrandConfig();
  const verifyUrl = `${brand.websiteUrl}/newsletter/verify/${verificationToken}`;
  const unsubscribeUrl = `${brand.websiteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken || "")}`;

  return `
    <div style="font-family: Arial, sans-serif; background: #f4f7f5; padding: 32px 0; color: #1f2937;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
        <div style="background: #0d5f39; padding: 28px 24px; text-align: center;">
          <img src="cid:org-logo" alt="${brand.orgName} Logo" style="max-width: 120px; height: auto; display: block; margin: 0 auto 12px; border-radius: 12px; background: white; padding: 8px;" />
          <h1 style="margin: 0; color: #ffffff; font-size: 28px;">${brand.orgName}</h1>
          <p style="margin: 8px 0 0; color: #d9fbe3; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;">${brand.orgTagline}</p>
        </div>

        <div style="padding: 32px 24px;">
          <h2 style="margin: 0 0 16px; font-size: 24px; color: #0d5f39;">Thank you for joining our newsletter, ${name || "friend"}!</h2>
          <p style="margin: 0 0 16px; line-height: 1.6; font-size: 16px;">
            We are grateful you chose to stay connected with us. To confirm your subscription, please verify your email below.
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: #2eb872; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 999px; font-weight: bold; font-size: 15px;">
              Confirm subscription
            </a>
          </div>

          <div style="background: #eefaf2; border-left: 4px solid #2eb872; padding: 16px 18px; border-radius: 12px; margin: 20px 0;">
            <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #1f2937;">
              Once confirmed, you’ll receive inspiring stories, impact updates, and opportunities to support our work.
            </p>
          </div>

          <p style="margin: 0 0 10px; font-size: 14px; color: #4b5563;">Need to change your mind? You can unsubscribe anytime using the secure link below.</p>
          <p style="margin: 0; font-size: 14px; color: #4b5563;"><a href="${unsubscribeUrl}" style="color: #0d5f39;">Unsubscribe from newsletter</a></p>
        </div>

        <div style="background: #f3f4f6; padding: 18px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0 0 12px; font-size: 14px; color: #374151;">Follow us</p>
          <div style="display: flex; justify-content: center; gap: 12px;">
            <a href="${brand.facebookUrl}" style="color: #0d5f39; text-decoration: none; font-weight: bold;">Facebook</a>
            <a href="${brand.xUrl}" style="color: #0d5f39; text-decoration: none; font-weight: bold;">X</a>
            <a href="${brand.tiktokUrl}" style="color: #0d5f39; text-decoration: none; font-weight: bold;">TikTok</a>
          </div>
        </div>
      </div>
    </div>`;
}

async function sendContactEmails(contact) {
  const recipient = process.env.CONTACT_RECIPIENT || process.env.SMTP_USER;

  await Promise.all([
    sendEmail({
      to: contact.email,
      subject: "We received your message",
      text: `Hello ${contact.name},\n\nThank you for contacting Seeds of Love Foundation. We have received your message and will get back to you as soon as possible.\n\nYour subject: ${contact.subject}`,
    }),
    sendEmail({
      to: recipient,
      replyTo: contact.email,
      subject: `New contact message: ${contact.subject}`,
      text: `From: ${contact.name} <${contact.email}>\nSubject: ${contact.subject}\n\n${contact.message}`,
    }),
  ]);

  return { sent: true };
}

async function sendReplyEmail(contact, reply) {
  return sendEmail({
    to: contact.email,
    subject: `Re: ${contact.subject}`,
    text: `Hello ${contact.name},\n\n${reply}\n\nSeeds of Love Foundation`,
  });
}

async function sendNewsletterWelcomeEmail({
  email,
  name,
  verificationToken,
  unsubscribeToken,
}) {
  const brand = getBrandConfig();

  return sendEmail({
    to: email,
    replyTo: process.env.CONTACT_RECIPIENT || process.env.SMTP_USER,
    subject: `Confirm your ${brand.orgName} newsletter subscription`,
    html: buildNewsletterWelcomeHtml(
      name,
      email,
      verificationToken,
      unsubscribeToken,
    ),
    attachments: [getLogoAttachment()],
    text: `Hello ${name || "friend"},\n\nThank you for subscribing to ${brand.orgName}. Please confirm your subscription here: ${brand.websiteUrl}/newsletter/verify/${verificationToken}\n\nUnsubscribe here: ${brand.websiteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken || "")}\n\n${brand.orgName}`,
  });
}

module.exports = {
  buildSponsorReminderEmail,
  buildNewsletterWelcomeHtml,
  sendEmail,
  sendSponsorReminderEmail,
  sendContactEmails,
  sendReplyEmail,
  sendNewsletterWelcomeEmail,
};