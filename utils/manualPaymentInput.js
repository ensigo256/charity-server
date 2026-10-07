const ALLOWED_MANUAL_PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Mobile Money",
  "ACH",
  "PayPal",
  "Zelle",
  "Stripe",
  "Check",
  "Other",
];

function normalizeManualPaymentInput(data = {}) {
  const amount = Number(data.amount);
  const method = String(data.method || "").trim();
  const transactionId = String(data.transactionId || "").trim();
  const notes = String(data.notes || "").trim();

  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    throw new Error("Payment amount must be greater than zero and no more than 1,000,000.");
  }
  if (!ALLOWED_MANUAL_PAYMENT_METHODS.includes(method)) {
    throw new Error("A valid manual payment method is required.");
  }
  if (transactionId.length < 1 || transactionId.length > 255) {
    throw new Error("Transaction reference must be between 1 and 255 characters.");
  }
  if (notes.length > 1000) {
    throw new Error("Payment notes must be no more than 1,000 characters.");
  }

  return { amount, method, transactionId, notes };
}

module.exports = { normalizeManualPaymentInput };