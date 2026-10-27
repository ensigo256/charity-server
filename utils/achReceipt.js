function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("ACH receipt amounts must be finite and nonnegative.");
  }
  return Math.round(amount * 100);
}

function calculateAchReceipt({ pledgedAmount, totalPaid, receivedAmount }) {
  const pledgeCents = toCents(pledgedAmount);
  const paidCents = toCents(totalPaid);
  const receivedCents = toCents(receivedAmount);

  if (pledgeCents <= 0 || receivedCents <= 0) {
    throw new Error("The pledge and received amount must be greater than zero.");
  }

  const remainingCents = Math.max(pledgeCents - paidCents, 0);
  if (receivedCents > remainingCents) {
    const error = new Error(
      `The received amount exceeds the remaining pledge of ${(remainingCents / 100).toFixed(2)}. Review the transfer before recording it.`,
    );
    error.code = "ACH_OVERPAYMENT";
    error.statusCode = 409;
    throw error;
  }

  const nextTotalCents = paidCents + receivedCents;
  return {
    totalPaid: nextTotalCents / 100,
    remaining: (pledgeCents - nextTotalCents) / 100,
    fullyFunded: nextTotalCents >= pledgeCents,
  };
}

module.exports = { calculateAchReceipt };
