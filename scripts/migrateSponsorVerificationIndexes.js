const mongoose = require("mongoose");
require("dotenv").config();
const { connectDb } = require("../configs/connectDb");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");
const { normalizeEmail } = require("../utils/sponsorVerification");

const isApply = process.argv.includes("--apply");
const currentStatuses = ["Active", "Pending"];

async function migrateSponsorVerificationIndexes() {
  const [sponsorships, verifiedSponsors] = await Promise.all([
    Sponsorships.find({ status: { $in: currentStatuses } })
      .select("_id child donor status")
      .lean(),
    Sponsor.find({ emailVerified: true })
      .select("_id profile.email")
      .lean(),
  ]);
  const pairGroups = new Map();
  for (const sponsorship of sponsorships) {
    const key = `${sponsorship.child}:${sponsorship.donor}`;
    const ids = pairGroups.get(key) || [];
    ids.push(sponsorship._id);
    pairGroups.set(key, ids);
  }
  const duplicatePairs = [...pairGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([pair, ids]) => ({ pair, count: ids.length, sponsorshipIds: ids.map(String) }));
  const emailGroups = new Map();
  for (const sponsor of verifiedSponsors) {
    const email = normalizeEmail(sponsor.profile?.email);
    if (!email) continue;
    const ids = emailGroups.get(email) || [];
    ids.push(String(sponsor._id));
    emailGroups.set(email, ids);
  }
  const duplicateVerifiedEmails = [...emailGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([email, ids]) => ({ email, sponsorIds: ids }));
  const report = {
    mode: isApply ? "apply" : "dry-run",
    currentSponsorships: sponsorships.length,
    currentSponsorChildPairs: pairGroups.size,
    duplicateCurrentPairs: duplicatePairs,
    verifiedSponsorProfiles: verifiedSponsors.length,
    duplicateVerifiedEmails,
    indexesToEnsure: [
      "unique_current_sponsor_child_pair",
      "unique_verified_sponsor_email",
    ],
  };
  console.log(JSON.stringify(report, null, 2));

  if (!isApply) {
    console.log("No data changed. Resolve all reported duplicate pairs/emails before applying.");
    return;
  }
  if (duplicatePairs.length || duplicateVerifiedEmails.length) {
    throw new Error("Migration refused: resolve duplicate current pairs and verified emails first.");
  }

  const pairUpdates = [];
  for (const [pair, ids] of pairGroups) {
    pairUpdates.push({
      updateOne: {
        filter: { _id: ids[0] },
        update: { $set: { activePairKey: pair } },
      },
    });
  }
  if (pairUpdates.length) {
    await Sponsorships.collection.bulkWrite(pairUpdates, { ordered: true });
  }

  const emailUpdates = verifiedSponsors
    .map((sponsor) => ({
      _id: sponsor._id,
      email: normalizeEmail(sponsor.profile?.email),
    }))
    .filter((sponsor) => sponsor.email);
  if (emailUpdates.length) {
    await Sponsor.collection.bulkWrite(
      emailUpdates.map(({ _id, email }) => ({
        updateOne: {
          filter: { _id },
          update: { $set: { "profile.email": email } },
        },
      })),
      { ordered: true },
    );
  }

  await Promise.all([
    Sponsorships.collection.createIndex(
      { activePairKey: 1 },
      { unique: true, sparse: true, name: "unique_current_sponsor_child_pair" },
    ),
    Sponsor.collection.createIndex(
      { "profile.email": 1 },
      {
        unique: true,
        partialFilterExpression: { emailVerified: true },
        name: "unique_verified_sponsor_email",
      },
    ),
  ]);
  console.log(`Migrated ${pairUpdates.length} current sponsorship pair key(s).`);
}

async function main() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("Missing required environment variable: DB_URL");
    }
    await connectDb(process.env.DB_URL);
    await migrateSponsorVerificationIndexes();
  } catch (error) {
    console.error("Sponsor verification index migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
