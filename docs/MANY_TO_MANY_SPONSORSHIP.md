# Sponsor–Child Many-to-Many Rollout

Sponsorship records are the relationship source of truth. A record connects one child to one sponsor and retains that relationship's status, amount, dates, and payments. Child and sponsor profile references remain temporarily for legacy migration only; new sponsorship operations must not depend on them.

The payment method is also relationship-specific; a sponsor identity may use ACH for one child and Stripe for another.

The public profile list continues to include both `Available` and `Sponsored` child profiles. Public responses include `sponsorCount` for Active and Pending sponsorship records. The current policy allows additional pledges without an aggregate funding cap.

## Legacy relationship migration

Back up the database before migration. First run the migration in dry-run mode:

```powershell
pnpm db:migrate:legacy-sponsorships
```

The dry run reports the number of legacy references, unique pairs, conflicting children, and eligible relationships without changing data. Resolve conflicting child/sponsor references before applying; the migration skips all relationships for a child whose legacy pointers disagree.

After reviewing the report and reconciling conflicts, apply the idempotent backfill:

```powershell
pnpm db:migrate:legacy-sponsorships -- --apply
```

The script creates an Active sponsorship for each eligible legacy pair that does not already have an Active or Pending record. It does not merge or alter existing sponsorship/payment history and does not delete the legacy references. Review the result before planning a later removal of deprecated profile fields.

The migration requires `DB_URL` in the backend environment. It never writes in dry-run mode.

## Email identity and duplicate-pair protection

New public sponsorship pledges use a separate email-verification request before creating a sponsor or sponsorship record. Review [SPONSOR_EMAIL_VERIFICATION.md](./SPONSOR_EMAIL_VERIFICATION.md) for the verification lifecycle, admin review queue, and the required uniqueness-index preflight. Run the legacy sponsorship-reference migration and the verification-index migration separately after reviewing each report.
