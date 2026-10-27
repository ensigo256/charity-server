function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Payment amounts must be finite and nonnegative.");
  }
  return Math.round(amount * 100);
}

function getExpectedStripeAmount(sponsorship, configuredAmount) {
  if (sponsorship?.status !== "Pending") {
    const amount = Number(configuredAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("The expected payment amount must be greater than zero.");
    }
    return Math.round(amount * 100) / 100;
  }

  const remainingCents = Math.max(
    toCents(sponsorship.amount) - toCents(sponsorship.totalPaid || 0),
    0,
  );
  return remainingCents / 100;
}

function isStripeOverpayment(actualAmount, expectedAmount) {
  return toCents(actualAmount) > toCents(expectedAmount);
}

function getRemainingStripeAmount(expectedAmount, approvedAmounts = []) {
  const expectedCents = toCents(expectedAmount);
  const paidCents = approvedAmounts.reduce(
    (total, amount) => total + toCents(amount),
    0,
  );
  return Math.max(expectedCents - paidCents, 0) / 100;
}

module.exports = {
  getExpectedStripeAmount,
  getRemainingStripeAmount,
  isStripeOverpayment,
};
