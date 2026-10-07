const EDITABLE_DONATION_FIELDS = [
  "amount",
  "period",
  "expectedFundsDate",
  "remindByEmail",
];

function pickEditableDonationFields(donation = {}) {
  return Object.fromEntries(
    EDITABLE_DONATION_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(donation, field))
      .map((field) => [field, donation[field]]),
  );
}

module.exports = { pickEditableDonationFields };