const mongoose = require("mongoose");
const { connectDb } = require("../configs/connectDb");
const { loadConfig } = require("../configs/env");

const MIGRATION_ID = "20261004-enable-sponsor-email-reminders";

async function enableSponsorEmailReminders() {
  const config = loadConfig();
  await connectDb(config.dbUrl);

  try {
    const database = mongoose.connection.db;
    const migrations = database.collection("application_migrations");
    let migration = await migrations.findOne({ _id: MIGRATION_ID });
    if (migration?.status === "completed") {
      console.log("Sponsor reminder preference migration has already run.");
      return;
    }
    if (!migration) {
      migration = {
        _id: MIGRATION_ID,
        status: "running",
        startedAt: new Date(),
      };
      try {
        await migrations.insertOne(migration);
      } catch (error) {
        if (error.code !== 11000) throw error;
        migration = await migrations.findOne({ _id: MIGRATION_ID });
        if (migration?.status === "completed") {
          console.log("Sponsor reminder preference migration has already run.");
          return;
        }
      }
    }

    const result = await database.collection("sponsors").updateMany(
      {
        reminderPreferenceInitializedAt: null,
        $or: [
          { createdAt: { $lte: migration.startedAt } },
          { createdAt: { $exists: false } },
        ],
      },
      {
        $set: {
          "donation.remindByEmail": true,
          reminderPreferenceInitializedAt: new Date(),
        },
      },
    );
    await migrations.updateOne(
      { _id: MIGRATION_ID, status: "running" },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          modifiedCount: (migration.modifiedCount || 0) + result.modifiedCount,
        },
      },
    );
    console.log(
      `Enabled sponsor email reminders on ${result.modifiedCount} existing profiles.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

enableSponsorEmailReminders().catch((error) => {
  console.error("Failed to enable sponsor email reminders:", error.message);
  process.exitCode = 1;
});