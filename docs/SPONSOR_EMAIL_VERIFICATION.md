# Public Sponsor Email Verification

Public sponsorship requests must be verified before a sponsor profile, sponsorship record, or payment session is created.

## Flow and controls

- The ACH, Stripe Payment Link, and Stripe Checkout intake routes create a temporary verification request only.
- The request stores the submitted pledge details and an SHA-256 hash of a random, high-entropy token. The raw token is sent in the URL fragment so it is not included in the initial HTTP request or server access logs.
- The sponsor explicitly confirms on the website. The link expires after 24 hours. Verification creates a relationship only once; repeating the confirmation during the validity window recovers the same pledge/payment continuation result.
- Verified email is the sponsor identity key. Email is normalized to lowercase. Phone is compared as supporting evidence only; conflicting phone details or multiple existing profiles enter admin identity review instead of being silently merged.
- One Active or Pending sponsorship is allowed per sponsor-child pair. More support for that child must be handled through the existing relationship/payment workflow, not a second relationship.
- Payment method is stored on the sponsorship relationship, not treated as a permanent sponsor-level choice, so a returning sponsor can choose ACH or Stripe for different children.
- Unverified requests are available to authorized sponsorship staff. Staff can resend the email, record contact follow-up, and resolve an already-verified legacy identity conflict; staff cannot mark an unverified email as verified.
- Requests are retained until 30 days after expiration, then removed by MongoDB TTL cleanup. Review and apply the organization's retention policy before production rollout.
- An hourly worker expires requests and creates an in-app admin digest when pending verifications are within six hours of expiry.

## Database preflight and index migration

Back up the database before applying index changes. The script is report-only by default:

```powershell
npm run db:migrate:sponsor-verification
```

The report lists duplicate Active/Pending sponsor-child pairs and duplicate normalized emails among already-verified sponsor identities. Resolve all listed conflicts before applying. The script refuses to apply when collisions remain.

After review and backup, apply the backfill and unique indexes:

```powershell
npm run db:migrate:sponsor-verification -- --apply
```

The migration backfills `activePairKey` on current sponsorship relationships, normalizes already-verified sponsor email addresses, and ensures unique sparse/partial indexes. It does not merge sponsor records, cancel sponsorships, or alter payment history. The existing legacy sponsorship-reference migration remains separate.

The migration requires `DB_URL`. Do not run it against production without an approved backup, reviewed preflight report, and a deployment window that accounts for MongoDB index creation and transaction support.
