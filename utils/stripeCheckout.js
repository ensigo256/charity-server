const buildStripeCheckoutSessionData = ({
  childId,
  childName,
  sponsor,
  donation,
  successUrl,
  cancelUrl,
}) => {
  const amount = Number(donation?.amount);
  const period = String(donation?.period || "Monthly");
  const allowedPeriods = ["Monthly", "3 Months", "6 Months", "Yearly"];

  if (!Number.isFinite(amount) || amount < 5 || amount > 100000) {
    throw new Error("Donation amount must be between $5 and $100,000.");
  }

  if (!allowedPeriods.includes(period)) {
    throw new Error("Donation period is invalid.");
  }

  const normalizedName = String(sponsor?.name || sponsor?.fullName || "").trim();
  const email = String(sponsor?.email || "").trim().toLowerCase();
  const phone = String(sponsor?.phone || "").trim();

  if (!normalizedName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid sponsor name and email are required.");
  }

  if (!childId) {
    throw new Error("A valid child is required.");
  }

  return {
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: `Child sponsorship for ${childName || "a child"}`,
            description: `${period} sponsorship donation`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      childId: String(childId),
      childName: String(childName || "Child"),
      sponsorName: normalizedName,
      sponsorEmail: email,
      sponsorPhone: phone,
      donationAmount: String(amount),
      donationPeriod: period,
    },
    success_url:
      successUrl ||
      `${process.env.WEBSITE_URL || "http://localhost:3000"}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:
      cancelUrl ||
      `${process.env.WEBSITE_URL || "http://localhost:3000"}/stripe/cancel`,
  };
};

module.exports = {
  buildStripeCheckoutSessionData,
};
