# Stripe Payment Link Sponsorships

The public sponsorship flow uses the organization's Stripe-hosted Payment Link. It does not need a Stripe API secret or webhook signing secret. Because there is no webhook/API integration, the system cannot automatically tell whether a sponsor completed checkout or whether funds settled. Staff verify payments manually in Stripe Dashboard.

## Billing behavior

Stripe checkout is a one-time payment. The sponsorship's Monthly, 3 Months, 6 Months, or Yearly value is the pledge/reminder cadence; it does not create automatic recurring charges. Reminder emails include a payment-page link for a new one-time payment when a contribution is due.

## Stripe Dashboard setup

Create a Payment Link that:

- Accepts a donor-chosen one-time amount.
- Collects the donor's name and email address.
- Is configured for the organization's Stripe account.

An administrator saves the HTTPS Payment Link URL and the admin payment-attempt alert email in Dashboard → Payment settings. The initial alert recipient is `info@ensigooflove.org`. The same configured Payment Link is used by public child sponsorship and homepage donations. The link itself is public configuration, not a secret; do not put Stripe API keys or webhook signing secrets in the frontend or `NEXT_PUBLIC_` variables.

For initial deployment or recovery, `STRIPE_PAYMENT_LINK_URL` in the backend environment is supported as a fallback until a dashboard value is saved. The dashboard-managed value takes precedence.

The homepage donation button opens Stripe checkout directly and does not create a child sponsorship or an app-side donation record. Child sponsorships use the app-hosted `/pay/<opaque-token>` page, both after initial pledge submission and from due-date reminder emails. The token is unguessable, stored as a hash, expires, and resolves only to the pledge details needed for payment.

## Payment-attempt flow

The sponsor reviews the amount and instructions on the payment page and explicitly clicks **Continue to Stripe**. That action creates an `awaiting_verification` attempt with an attempt reference and then redirects to the configured Payment Link with that reference as `client_reference_id`.

The attempt is an intent signal only. A click, redirect, Stripe return, or email notification is not proof of payment. Attempts do not add to paid totals, update the next due date, or activate a pending sponsorship. Repeated clicks reuse an open attempt for the same pledge due date; attempts expire, and a new one may be created after the previous attempt expires.

Payment pages instruct sponsors to pay only the displayed amount. Extra funds are not applied to the sponsorship; sponsors must contact `info@ensigooflove.org` before changing their pledge. After Stripe confirms checkout, sponsors may close the Stripe checkout page. The app still needs staff verification.

When a payment attempt starts, the system creates in-app alerts for active admins and emails the configured alert address. The alert says the sponsor started checkout and asks staff to verify it; it does not claim that a payment was made. Alert delivery errors are recorded and shown in the staff queue.

## Manual verification and approval

Staff open the Stripe Dashboard, locate the transaction using the attempt `client_reference_id`, and verify that the payment succeeded in the organization's Stripe account. In Dashboard → Sponsorships → Stripe payment attempts awaiting verification, staff enter the actual payment amount, date, and Stripe PaymentIntent ID (`pi_...`) and approve the transaction.

Only approval creates a completed payment record and updates the sponsorship's paid total. Duplicate PaymentIntent IDs are rejected. An amount above the pledge is flagged for management review and is not recorded or counted; resolve/refund the excess outside the app before closing the attempt. A verified partial amount may be recorded and leaves an initial sponsorship pending until the pledge is fully funded.

## Deployment and legacy checkout

Deploy the backend before the public website and staff dashboard so settings, page-token, and payment-attempt endpoints are available. Confirm that MongoDB creates the unique attempt/reference and token indexes and the token expiry index in the production database before enabling reminders.

The legacy Checkout Session endpoint and webhook remain for sessions created before the Payment Link migration. They use Stripe API and webhook secrets and are separate from the no-code Payment Link flow; retire them only after those payments are reconciled.
