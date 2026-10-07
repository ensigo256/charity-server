const Sponsorships = require("../models/sponsorships");
const { readStoredSettings } = require("../controllers/achSettingsController");
const { sendAchInstructionsEmail } = require("./mail");

const SAFE_FAILURE_MESSAGE = "Email delivery failed. An administrator can retry delivery.";

async function deliverAchInstructions(pledgeId, dependencies = {}) {
  const sponsorships = dependencies.sponsorships || Sponsorships;
  const getSettings = dependencies.getSettings || readStoredSettings;
  const sendEmail = dependencies.sendEmail || sendAchInstructionsEmail;
  const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000);
  const pledge = await sponsorships.findOneAndUpdate(
    {
      _id: pledgeId,
      status: "Pending",
      publicPledgeReference: { $exists: true, $ne: "" },
      $or: [
        { "achInstructionEmail.status": { $in: [null, "pending", "failed"] } },
        {
          "achInstructionEmail.status": "sending",
          "achInstructionEmail.lastAttemptAt": { $lt: staleSendingBefore },
        },
      ],
    },
    {
      $set: {
        "achInstructionEmail.status": "sending",
        "achInstructionEmail.lastAttemptAt": new Date(),
        "achInstructionEmail.lastError": "",
      },
      $inc: { "achInstructionEmail.attempts": 1 },
    },
    { new: true },
  ).populate("donor");

  if (!pledge) {
    const current = await sponsorships.findById(pledgeId);
    return {
      status: current?.achInstructionEmail?.status || "unavailable",
      attempts: current?.achInstructionEmail?.attempts || 0,
    };
  }

  try {
    const settings = await getSettings();
    const email = pledge.donor?.profile?.email || pledge.donor?.sponsor?.email;
    if (!settings || !email) throw new Error("delivery unavailable");

    await sendEmail({
      email,
      name: pledge.donor?.profile?.fullName || pledge.donor?.sponsor?.name,
      settings,
      pledge: {
        reference: pledge.publicPledgeReference,
        amount: pledge.amount,
        currency: pledge.currency || "USD",
        period: pledge.frequency,
      },
    });
    await sponsorships.updateOne(
      { _id: pledge._id, "achInstructionEmail.status": "sending" },
      {
        $set: {
          "achInstructionEmail.status": "sent",
          "achInstructionEmail.sentAt": new Date(),
          "achInstructionEmail.lastError": "",
        },
      },
    );
    return { status: "sent", attempts: pledge.achInstructionEmail?.attempts || 1 };
  } catch {
    await sponsorships.updateOne(
      { _id: pledge._id, "achInstructionEmail.status": "sending" },
      {
        $set: {
          "achInstructionEmail.status": "failed",
          "achInstructionEmail.lastError": SAFE_FAILURE_MESSAGE,
        },
      },
    );
    return { status: "failed", attempts: pledge.achInstructionEmail?.attempts || 1 };
  }
}

module.exports = { deliverAchInstructions, SAFE_FAILURE_MESSAGE };