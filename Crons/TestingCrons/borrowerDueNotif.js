require("dotenv").config();
const cron = require("node-cron");
const { sendSMS, formatPhoneNumber } = require("../../services/smsService");
const { decrypt } = require("../../utils/crypt");

console.log("✅ triggerNotificationTest.js loaded and ready...");

const checkNotificationsTest = async (db) => {
  const now = new Date();
  const notificationsCollection = db.collection("borrower_notifications");
  const borrowersCollection = db.collection("borrowers_account");

  console.log("⏰ [TEST] Checking for due borrower notifications at:", now.toLocaleString());

  const dueNotifications = await notificationsCollection
    .find({
      notifyAt: { $lte: now },
      read: false,
      viewed: false,
    })
    .toArray();

  console.log(`🧾 [TEST] Found ${dueNotifications.length} notifications to trigger.`);

  for (const notif of dueNotifications) {
    try {
      const borrower = await borrowersCollection.findOne({ borrowersId: notif.borrowersId });
      const encryptedPhone = borrower?.phoneNumber;
      let decryptedPhone = encryptedPhone ? decrypt(encryptedPhone) : null;
      if (!decryptedPhone && encryptedPhone) decryptedPhone = encryptedPhone;

      const formattedPhone = decryptedPhone ? formatPhoneNumber(decryptedPhone) : null;

      if (formattedPhone) {
        await sendSMS(formattedPhone, `[TEST] ${notif.message}`, "Gethsemane");
        console.log(`📩 [TEST] SMS sent to ${formattedPhone}: ${notif.message}`);
      } else {
        console.warn(`[⚠️ SMS SKIPPED] Missing/invalid phone for borrower ${notif.borrowersId}`);
      }

      await notificationsCollection.updateOne(
        { _id: notif._id },
        { $set: { viewed: true, triggeredAt: new Date() } }
      );
    } catch (err) {
      console.error(`[TEST ERROR] Failed processing notification ${notif._id}:`, err.message);
    }
  }
};

const startBorrowerDueTest = (db) => {
  console.log("🟢 [TEST] Borrower notification cron scheduled (every 30 seconds)...");
  cron.schedule("*/30 * * * * *", async () => {
    await checkNotificationsTest(db);
  });
};

module.exports = { startBorrowerDueTest };
