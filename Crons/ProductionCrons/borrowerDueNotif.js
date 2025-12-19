require("dotenv").config();
const cron = require("node-cron");
const { sendSMS, formatPhoneNumber } = require("../../services/smsService");
const { decrypt } = require("../../utils/crypt");

console.log("✅ triggerNotificationProd.js loaded and ready...");

const checkNotifications = async (db) => {
  const now = new Date();
  const notificationsCollection = db.collection("borrower_notifications");
  const borrowersCollection = db.collection("borrowers_account");

  console.log("⏰ [PROD] Checking for due borrower notifications at:", now.toLocaleString());

  const dueNotifications = await notificationsCollection
    .find({
      notifyAt: { $lte: now },
      read: false,
      viewed: false,
    })
    .toArray();

  console.log(`🧾 [PROD] Found ${dueNotifications.length} notifications to trigger.`);

  for (const notif of dueNotifications) {
    try {
      const borrower = await borrowersCollection.findOne({ borrowersId: notif.borrowersId });
      const encryptedPhone = borrower?.phoneNumber;
      let decryptedPhone = encryptedPhone ? decrypt(encryptedPhone) : null;
      if (!decryptedPhone && encryptedPhone) decryptedPhone = encryptedPhone;

      const formattedPhone = decryptedPhone ? formatPhoneNumber(decryptedPhone) : null;

      if (formattedPhone) {
        await sendSMS(formattedPhone, notif.message, "Gethsemane");
        console.log(`📩 [PROD] SMS sent to ${formattedPhone}: ${notif.message}`);
      } else {
        console.warn(`[⚠️ SMS SKIPPED] Missing/invalid phone for borrower ${notif.borrowersId}`);
      }

      await notificationsCollection.updateOne(
        { _id: notif._id },
        { $set: { viewed: true, triggeredAt: new Date() } }
      );
    } catch (err) {
      console.error(`[ERROR] Failed processing notification ${notif._id}:`, err.message);
    }
  }
};

const startBorrowerDueProd = (db) => {
  console.log("🟢 [PROD] Borrower notification cron scheduled (every 5 mins)...");
  cron.schedule("*/5 * * * *", async () => {
    await checkNotifications(db);
  });
};

module.exports = { startBorrowerDueProd };
