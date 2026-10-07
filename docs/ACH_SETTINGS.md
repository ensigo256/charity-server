# ACH Settings and Email Operations

ACH sponsorship pledges use manual bank transfer. The API stores organization transfer details encrypted in MongoDB and sends them to the sponsor by email. Public pledge responses contain only pledge and email-delivery status; bank details are never returned by a public API.

## Encryption key

Set `ACH_SETTINGS_ENCRYPTION_KEY` as a server-side deployment secret. It must be exactly 64 hexadecimal characters representing 32 random bytes. Generate a key with:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Keep the key outside the database and source control. Back it up in the organization’s secret manager. Losing or rotating it without decrypting/re-encrypting the stored settings will make the bank details unavailable. To rotate, use a planned migration that decrypts with the old key and encrypts with the new key before replacing the deployment secret.

## Import existing environment values

After setting the encryption key and confirming `DB_URL`, run this once from the server repository:

```sh
npm run db:migrate:ach-settings
```

The script validates the existing `ACH_BENEFICIARY_NAME`, `ACH_BANK_NAME`, `ACH_ROUTING_NUMBER`, `ACH_ACCOUNT_NUMBER`, `ACH_ACCOUNT_TYPE`, and `ACH_REFERENCE_INSTRUCTIONS` variables, encrypts them, and does not print their values. It refuses to replace an existing database record unless explicitly run with `--force`:

```sh
node scripts/migrateAchSettings.js --force
```

Back up the database and verify the masked settings response in the admin dashboard before removing the old ACH variables from deployment configuration. Do not expose these variables to the website build or prefix them with `NEXT_PUBLIC_`.

## Email delivery

ACH instructions use the existing Resend/SMTP delivery configuration. Pledges persist even if a provider is unavailable. Delivery status and a sanitized error are stored with each pledge; an admin can retry failed sends from Dashboard → Sponsorships. Retry sends the current organization details and the original pledge reference. Provider acceptance does not guarantee mailbox delivery, so the donor-facing copy should say the email was sent, not that it was received.

Bank details in email are not end-to-end encrypted. Validate donor email addresses, keep email provider access restricted, do not include donor bank credentials (the workflow never requests them), and do not log email bodies or settings payloads. Review failed deliveries and provider delivery/bounce events through the provider’s secure operational tools.

## Rollback

Rollback the website/dashboard before removing the database record if needed. The prior public flow depended on server environment variables and returned bank details in public responses; do not re-enable that behavior. To roll back safely, retain the encrypted database record and key, and restore only a server-side delivery implementation that does not serialize ACH credentials in public responses.