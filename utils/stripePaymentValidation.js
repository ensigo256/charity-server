function getStripeSessionValidationError(session, sponsorship) {
  if (session?.status !== "complete" || session?.payment_status !== "paid") {
    return "Stripe Checkout session is not paid and complete.";
  }

  const currency = String(session.currency || "").toLowerCase();
  const expectedCurrency = String(sponsorship?.currency || "USD").toLowerCase();
  if (currency !== expectedCurrency || currency !== "usd") {
    return "Stripe Checkout currency does not match the pledge.";
  }

  const expectedAmount = Math.round(Number(sponsorship?.amount) * 100);
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== expectedAmount) {
    return "Stripe Checkout amount does not match the pledge.";
  }

  const metadata = session.metadata || {};
  if (
    String(metadata.sponsorshipId || "") !== String(sponsorship?._id || "") ||
    String(metadata.sponsorId || "") !== String(sponsorship?.donor || "") ||
    String(metadata.childId || "") !== String(sponsorship?.child || "")
  ) {
    return "Stripe Checkout metadata does not match the pledge.";
  }

  return null;
}

module.exports = { getStripeSessionValidationError };