# Email messages

The dashboard Messages page stores website enquiries and dashboard email activity in MongoDB. Resend handles outbound delivery and inbound email notifications.

## Configuration

Set these backend environment variables:

- `RESEND_API_KEY` — server-side Resend API key.
- `RESEND_WEBHOOK_SECRET` — signing secret shown for the Resend webhook.
- `MAIL_FROM` — verified sender address, for example `Foundation <mail@example.org>`.
- `CONTACT_RECIPIENT` — optional reply-to address for dashboard messages.

To receive email, configure a Resend receiving domain/address and its DNS records. Add a Resend webhook for the `email.received` event, pointing to:

```text
https://<public-api-host>/api/messages/resend/webhook
```

The endpoint verifies the signed raw request body, retrieves the full email from Resend, then persists it. Webhook retries are deduplicated by Resend's received-email ID. The endpoint must be publicly reachable over HTTPS in production.

## Dashboard APIs

- `GET /api/messages/all` — persisted inbox and sent records.
- `GET /api/messages/sponsors` — active sponsor recipients (requires `messages.manage`).
- `POST /api/messages/send` — sends to a sponsor ID (requires `messages.manage`).
- `POST /api/messages/:id/reply` — sends a reply and persists it in the same thread.

The dashboard never receives the Resend API key or chooses a sponsor's recipient address directly; the backend resolves the email from the selected sponsor record.
