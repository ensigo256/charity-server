const mongoose = require("mongoose");
require("dotenv").config();
const { connectDb } = require("../configs/connectDb");
const ChildProfile = require("../models/childProfile");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");

const isApply = process.argv.includes("--apply");
const validFrequencies = new Set(["Monthly", "3 Months", "6 Months", "Yearly"]);

async function migrateLegacySponsorships() {
  const [childrenWithSponsor, sponsorsWithChild] = await Promise.all([
    ChildProfile.find({ sponsor: { $exists: true, $ne: null } })
      .select("_id sponsor createdAt")
      .lean(),
    Sponsor.find({
      child: { $exists: true, $ne: null },
      isArchived: { $ne: true },
    })
      .select("_id child createdAt donation")
      .lean(),
  ]);

  const relationships = new Map();
  const sponsorChildById = new Map(
    sponsorsWithChild.map((sponsor) => [
      String(sponsor._id),
      String(sponsor.child),
    ]),
  );
  const childSponsorById = new Map(
    childrenWithSponsor.map((child) => [
      String(child._id),
      String(child.sponsor),
    ]),
  );
  const conflictingChildIds = new Set();
  for (const child of childrenWithSponsor) {
    const reverseChildId = sponsorChildById.get(String(child.sponsor));
    if (reverseChildId && reverseChildId !== String(child._id)) {
      conflictingChildIds.add(String(child._id));
      conflictingChildIds.add(reverseChildId);
    }
    relationships.set(`${child._id}:${child.sponsor}`, {
      childId: child._id,
      sponsorId: child.sponsor,
      createdAt: child.createdAt,
    });
  }
  for (const sponsor of sponsorsWithChild) {
    const childSponsorId = childSponsorById.get(String(sponsor.child));
    if (childSponsorId && childSponsorId !== String(sponsor._id)) {
      conflictingChildIds.add(String(sponsor.child));
    }
    relationships.set(`${sponsor.child}:${sponsor._id}`, {
      childId: sponsor.child,
      sponsorId: sponsor._id,
      createdAt: sponsor.createdAt,
    });
  }

  const candidates = [...relationships.values()];
  const childIds = [...new Set(candidates.map((item) => String(item.childId)))];
  const sponsorIds = [...new Set(candidates.map((item) => String(item.sponsorId)))];
  const [children, sponsors, existing] = await Promise.all([
    ChildProfile.find({ _id: { $in: childIds } }).select("_id sponsorshipStatus").lean(),
    Sponsor.find({ _id: { $in: sponsorIds }, isArchived: { $ne: true } })
      .select("_id donation createdAt")
      .lean(),
    Sponsorships.find({
      child: { $in: childIds },
      donor: { $in: sponsorIds },
      status: { $in: ["Active", "Pending"] },
    })
      .select("child donor")
      .lean(),
  ]);

  const childrenById = new Map(children.map((child) => [String(child._id), child]));
  const sponsorsById = new Map(sponsors.map((sponsor) => [String(sponsor._id), sponsor]));
  const activePairs = new Set(
    existing.map((item) => `${item.child}:${item.donor}`),
  );
  const missing = candidates.filter((relationship) =>
    !conflictingChildIds.has(String(relationship.childId)) &&
    childrenById.has(String(relationship.childId)) &&
    sponsorsById.has(String(relationship.sponsorId)) &&
    childrenById.get(String(relationship.childId)).sponsorshipStatus === "Sponsored" &&
    !activePairs.has(`${relationship.childId}:${relationship.sponsorId}`),
  );

  console.log(JSON.stringify({
    mode: isApply ? "apply" : "dry-run",
    legacyChildReferences: childrenWithSponsor.length,
    legacySponsorReferences: sponsorsWithChild.length,
    uniqueLegacyPairs: candidates.length,
    skippedPairs: candidates.length - missing.length,
    conflictingChildren: conflictingChildIds.size,
    relationshipsToCreate: missing.length,
  }, null, 2));

  if (!isApply) {
    console.log("No data changed. Re-run with --apply to create the listed relationships.");
    return;
  }

  for (const relationship of missing) {
    const sponsor = sponsorsById.get(String(relationship.sponsorId));
    const startDate =
      sponsor.createdAt ||
      relationship.createdAt ||
      new Date();
    const sponsorship = new Sponsorships({
      child: relationship.childId,
      donor: relationship.sponsorId,
      startDate,
      amount: Number(sponsor.donation?.amount || 0),
      currency: "USD",
      frequency: validFrequencies.has(sponsor.donation?.period)
        ? sponsor.donation.period
        : "Monthly",
      status: "Active",
      payments: [],
      totalPaid: 0,
      notes: "Migrated from a legacy child-sponsor reference.",
    });
    await sponsorship.save();
  }

  console.log(`Created ${missing.length} sponsorship relationship(s).`);
}

async function main() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("Missing required environment variable: DB_URL");
    }
    await connectDb(process.env.DB_URL);
    await migrateLegacySponsorships();
  } catch (error) {
    console.error("Legacy sponsorship migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
