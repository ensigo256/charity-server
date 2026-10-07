const test = require("node:test");
const assert = require("node:assert/strict");
const { pickEditableChildProfileFields } = require("./childProfileInput");

test("retains supported child profile fields", () => {
  const fields = pickEditableChildProfileFields({
    firstName: "Amina",
    education: { currentLevel: "Primary" },
    publicPosterApproved: true,
  });

  assert.deepEqual(fields, {
    firstName: "Amina",
    education: { currentLevel: "Primary" },
    publicPosterApproved: true,
  });
});

test("drops sponsorship state and database-managed fields", () => {
  const fields = pickEditableChildProfileFields({
    firstName: "Amina",
    sponsor: "attacker-controlled-id",
    sponsorshipStatus: "Available",
    reportCards: [{ public_id: "unverified" }],
    _id: "attacker-controlled-id",
    createdAt: "2000-01-01",
  });

  assert.deepEqual(fields, { firstName: "Amina" });
});