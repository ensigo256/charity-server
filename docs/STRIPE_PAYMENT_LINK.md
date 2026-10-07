# Stripe Payment Link Sponsorships

Public child sponsorship uses the organization's Stripe-hosted Payment Link. The application does not need a Stripe API secret or webhook signing secret for this flow.

## Stripe Dashboard Setup

Create a Payment Link that:

- Accepts a donor-chosen one-time amount.
- Collects the donor's name and email address.
- Redirects after checkout to `https://<website-domain>/stripe/payment-pending`.

The sponsorship form records the selected child, donor details, and intended pledge amount before redirecting. It appends the pledge reference as Stripe's `client_reference_id` query parameter. Donors may enter an amount different from the intended pledge; staff must record the amount actually paid.

## Configure In Dashboard

An administrator enters the HTTPS Payment Link URL in Dashboard Settings. The same configured link is used by public child sponsorship and homepage donations. The link itself is public configuration, not a secret; do not put Stripe API keys or webhook signing secrets in the frontend or `NEXT_PUBLIC_` variables for this flow.

For initial deployment or recovery, `STRIPE_PAYMENT_LINK_URL` in the backend environment is supported as a fallback until a dashboard value is saved. The dashboard-managed value takes precedence.

The homepage opens Stripe checkout directly and Stripe collects the final amount and payer details. It does not create a child sponsorship or an app-side donation record. Child sponsorship submissions create pending pledge records and include the pledge reference as Stripe's `client_reference_id`.

Deploy the backend before the public website and dashboard. The old Checkout Session endpoint and webhook remain available temporarily for sessions created before migration; retire them only after those payments are reconciled.

## Manual Verification

The return page does not verify a payment. Staff must find the payment in Stripe Dashboard, match it to the pending pledge using the client reference ID when visible and donor email, amount, and time, then record the actual amount, payment date, and Stripe PaymentIntent ID (`pi_...`) in the dashboard. Duplicate PaymentIntent IDs are rejected.

If a verified payment is less than the remaining pledged amount, the payment is recorded but the pledge stays pending and the child is not assigned. Staff can record subsequent verified payments against the same pledge. The sponsorship activates when recorded completed payments reach or exceed the pledge amount and the child remains available.