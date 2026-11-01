# ACH Contact Settings and Email Operations

ACH sponsorship pledges use manual bank transfer. The API stores only the staff recipient email and sponsor instruction message. Organization and sponsor bank credentials are not sent in or returned by public API responses.

The pledge remains pending until staff review and approve a receipt. Partial receipts remain completed payment records while the pledge remains pending. Each bank reference must be unique.

## Encryption key

The settings record remains encrypted. Set `ACH_SETTINGS_ENCRYPTION_KEY` to exactly 64 hexadecimal characters representing 32 random bytes:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Keep this key in the server secret manager. Do not prefix it with `NEXT_PUBLIC_`.

## Migration and configuration

Set the staff inbox and optional custom message, then migrate the existing encrypted record:

```sh
ACH_RECIPIENT_EMAIL=ach-payments@example.org npm run db:migrate:ach-settings
```

Optional environment variables:

```text
ACH_SPONSOR_MESSAGE=Thank you for your support and kindness. Please contact {recipientEmail} to begin the payment process.
```

The migration decrypts the legacy record as a validation step, then replaces it with only `recipientEmail` and `sponsorMessage`. It never prints stored bank values.

## Email delivery

ACH pledge emails use the existing Resend/SMTP configuration. The email includes the pledge reference and configured staff inbox, but never organization routing or account numbers.

Sponsors must use a secure channel to provide ACH configurations. Staff should never request passwords, PINs, online banking credentials, or one-time codes. Email delivery status and a sanitized failure are stored with each pledge.