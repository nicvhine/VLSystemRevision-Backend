require("dotenv").config();
const cron = require("node-cron");
const { sendSMS, formatPhoneNumber } = require("../../services/smsService");
const { decrypt } = require("../../utils/crypt");

console.log("✅ triggerNotification.js loaded and ready to schedule checks...");

const checkNotifications = async (db) => {
  const now = new Date();
  const notificationsCollection = db.collection("borrower_notifications");
  const borrowersCollection = db.collection("borrowers_account");

  console.log("⏰ Checking for due borrower notifications at:", now.toLocaleString());

  // Find notifications that are due or past due and not yet triggered
  const dueNotifications = await notificationsCollection
    .find({
      notifyAt: { $lte: now },
      read: false,
      viewed: false,
    })
    .toArray();

  console.log(`🧾 Found ${dueNotifications.length} notifications to trigger.`);

  for (const notif of dueNotifications) {
    console.log(`🔔 Triggering notification for borrower ${notif.borrowersId}: ${notif.message}`);

    try {
      // Get borrower's phone number
      const borrower = await borrowersCollection.findOne({ borrowersId: notif.borrowersId });
      const encryptedPhone = borrower?.phoneNumber;
      let decryptedPhone = encryptedPhone ? decrypt(encryptedPhone) : null;
      if (!decryptedPhone && encryptedPhone) decryptedPhone = encryptedPhone;

      const formattedPhone = decryptedPhone ? formatPhoneNumber(decryptedPhone) : null;

      if (formattedPhone) {
        await sendSMS(formattedPhone, notif.message, "Gethsemane");
        console.log(`📩 SMS sent to ${formattedPhone}: ${notif.message}`);
      } else {
        console.warn(`[⚠️ SMS SKIPPED] Missing or invalid phone for borrower ${notif.borrowersId}`);
      }

      // Mark notification as triggered so it won't repeat
      await notificationsCollection.updateOne(
        { _id: notif._id },
        {
          $set: {
            viewed: true,
            triggeredAt: new Date(),
          },
        }
      );
    } catch (err) {
      console.error(`[ERROR] Failed processing notification ${notif._id}:`, err.message);
    }
  }
};

// 🕒 Run cron every 30 seconds (for testing)
const startNotificationCron = (db) => {
  console.log("🟢 Starting borrower notification cron job (every 30s)...");
  cron.schedule("*/30 * * * * *", async () => {
    await checkNotifications(db);
  });
};

module.exports = { startNotificationCron };
