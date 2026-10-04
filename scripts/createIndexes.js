const mongoose = require("mongoose");
const { connectDb } = require("../configs/connectDb");
const { loadConfig } = require("../configs/env");

const models = [
  require("../models/admin"),
  require("../models/blog"),
  require("../models/event"),
  require("../models/staff"),
  require("../models/childProfile"),
  require("../models/gallery"),
  require("../models/message"),
  require("../models/notification"),
  require("../models/subscriber"),
  require("../models/sponsor"),
  require("../models/sponsorships"),
  require("../models/sponsorReminderDelivery"),
];

async function createIndexes() {
  const config = loadConfig();
  await connectDb(config.dbUrl);

  try {
    for (const model of models) {
      await model.createIndexes();
      console.log(`Indexes ready: ${model.modelName}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

createIndexes().catch((error) => {
  console.error("Failed to create indexes:", error.message);
  process.exitCode = 1;
});
