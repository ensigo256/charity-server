const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Sponsorships = require("../models/sponsorships");
const Sponsor = require("../models/sponsor");
const SponsorVerificationRequest = require("../models/sponsorVerificationRequest");
const {
  createVerificationToken,
  currentPairKey,
  hashVerificationToken,
  normalizeEmail,
  normalizePhone,
  requestPurgeDate,
  verificationExpiry,
} = require("./sponsorVerification");

test("normalizes sponsor email and phone for identity matching", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Example.COM "), "jane.doe@example.com");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "14155550100");
  assert.equal(normalizePhone(""), "");
});

test("verification tokens are high entropy and stored as one-way hashes", () => {
  const first = createVerificationToken();
  const second = createVerificationToken();
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashVerificationToken(first.token));
  assert.notEqual(first.tokenHash, first.token);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
});

test("verification requests expire after 24 hours and retain cleanup data for 30 more days", () => {
  const now = new Date("2026-10-28T00:00:00.000Z");
  assert.equal(
    verificationExpiry(now).toISOString(),
    "2026-10-29T00:00:00.000Z",
  );
  assert.equal(
    requestPurgeDate(now).toISOString(),
    "2026-11-28T00:00:00.000Z",
  );
});

test("active and pending sponsorships acquire a unique pair key", async () => {
  const child = new mongoose.Types.ObjectId();
  const donor = new mongoose.Types.ObjectId();
  for (const status of ["Active", "Pending"]) {
    const sponsorship = new Sponsorships({
      child,
      donor,
      startDate: new Date(),
      amount: 10,
      status,
    });
    await sponsorship.validate();
    assert.equal(sponsorship.activePairKey, currentPairKey(child, donor));
  }
});

test("closed sponsorships release their unique pair key", async () => {
  const sponsorship = new Sponsorships({
    child: new mongoose.Types.ObjectId(),
    donor: new mongoose.Types.ObjectId(),
    startDate: new Date(),
    amount: 10,
    status: "Cancelled",
  });
  await sponsorship.validate();
  assert.equal(sponsorship.activePairKey, undefined);
});

test("sponsor and relationship schemas declare database uniqueness guards", () => {
  const sponsorshipIndexes = Sponsorships.schema.indexes();
  assert.ok(
    sponsorshipIndexes.some(
      ([keys, options]) =>
        keys.activePairKey === 1 &&
        options.unique === true &&
        options.sparse === true,
    ),
  );
  assert.ok(
    Sponsor.schema.indexes().some(
      ([keys, options]) =>
        keys["profile.email"] === 1 &&
        options.unique === true &&
        options.partialFilterExpression?.emailVerified === true,
    ),
  );
  assert.ok(
    SponsorVerificationRequest.schema.indexes().some(
      ([keys, options]) => keys.purgeAt === 1 && options.expireAfterSeconds === 0,
    ),
  );
});

test("verification request records validate without creating sponsor or sponsorship identities", async () => {
  const request = new SponsorVerificationRequest({
    requestId: "2eb1e8fa-a836-451b-b75d-1ad07b2a7102",
    tokenHash: hashVerificationToken("random-token"),
    profile: {
      fullName: "Jane Example",
      email: "jane@example.com",
      phone: "+1 415 555 0100",
    },
    donation: { amount: 25, period: "Monthly" },
    child: new mongoose.Types.ObjectId(),
    paymentMethod: "ach",
    expiresAt: verificationExpiry(),
    purgeAt: requestPurgeDate(),
  });
  await request.validate();
  assert.equal(request.status, "pending");
  assert.equal(request.sponsor, null);
  assert.equal(request.sponsorship, null);

  const sponsor = new Sponsor({
    profile: {
      fullName: "Jane Example",
      email: "jane@example.com",
      phone: "+1 415 555 0100",
    },
    donation: { amount: 25, period: "Monthly" },
  });
  assert.equal(sponsor.emailVerified, false);
});
