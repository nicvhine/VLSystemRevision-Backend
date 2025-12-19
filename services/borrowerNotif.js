require("dotenv").config();
const { addDays, format } = require("date-fns");
const notificationRepository = require("../repositories/notificationRepository");
const { sendSMS, formatPhoneNumber } = require("../services/smsService");
const { decrypt } = require("../utils/crypt");

async function getBorrowerNotifications(db) {
  const repo = notificationRepository(db);
  const notifs = await repo.getBorrowerNotifications();
  return await enrichWithActorProfilePic(db, notifs);
}

// === Generic role-based operations ===
async function markNotificationRead(db, role, id, borrowersId) {
  const repo = notificationRepository(db);
  if (role === "loan-officer") {
    return await repo.markLoanOfficerNotificationRead(id);
  } else if (role === "manager") {
    return await repo.markManagerNotificationRead(id);
  } else if (role === "borrower") {
    if (!borrowersId) throw new Error("Missing borrowersId");
    return await repo.markBorrowerNotificationRead(id, borrowersId);
  }
  throw new Error("Invalid role");
}

async function markAllRoleRead(db, role, borrowersId) {
  const repo = notificationRepository(db);
  if (role === "loan-officer") {
    return await repo.markAllLoanOfficerNotificationsRead();
  } else if (role === "manager") {
    return await repo.markAllManagerNotificationsRead();
  } else if (role === "borrower") {
    if (!borrowersId) throw new Error("Missing borrowersId");
    return await repo.markAllBorrowerNotificationsRead(borrowersId);
  }
  throw new Error("Invalid role");
}

// Schedule due date notifications (no SMS here) 
async function scheduleDueNotifications(db, collections) {
  if (!collections || collections.length === 0) return;

  const notificationsCollection = db.collection("borrower_notifications");
  const borrowersCollection = db.collection("borrowers_account");
  const notifications = [];

  for (const col of collections) {
    const daysBefore = [3, 2, 1, 0]; // days before due date

    // Get borrower's encrypted phone
    const borrower = await borrowersCollection.findOne({ borrowersId: col.borrowersId });
    const encryptedPhone = borrower?.appContact;
    let decryptedPhone = decrypt(encryptedPhone);
    if (!decryptedPhone && encryptedPhone) decryptedPhone = encryptedPhone;

    const formattedPhone = decryptedPhone ? formatPhoneNumber(decryptedPhone) : null;

    for (const days of daysBefore) {
      const notifyDate = addDays(col.dueDate, -days);
      const dueDateFormatted = format(col.dueDate, "yyyy-MM-dd");

      // Dynamic message tone based on urgency
      let messagePrefix = "";
      if (days >= 3) messagePrefix = "📢 REMINDER:";
      else if (days === 2) messagePrefix = "⚠️ NOTICE:";
      else if (days === 1) messagePrefix = "🚨 URGENT:";
      else messagePrefix = "❗ DUE TODAY:";

      const message =
        `${messagePrefix} Your payment for collection ${col.referenceNumber} ` +
        `is due on ${dueDateFormatted}` +
        (days > 0 ? ` (${days} day${days > 1 ? "s" : ""} left).` : ` (Today).`) +
        ` Please settle your payment to avoid penalties.`;

      const notification = {
        borrowersId: col.borrowersId,
        loanId: col.loanId,
        collectionRef: col.referenceNumber,
        message,
        read: false,
        viewed: false,
        createdAt: new Date(),
        notifyAt: notifyDate,
      };

      notifications.push(notification);

      // Send SMS immediately for scheduled notifications within range
      if (formattedPhone) {
        try {
          await sendSMS(formattedPhone, message, "Gethsemane");
          console.log(`📩 SMS sent to ${formattedPhone}: ${message}`);
        } catch (err) {
          console.error(`[SMS ERROR] Failed to send to ${formattedPhone}:`, err.message);
        }
      } else {
        console.warn(`[SMS SKIPPED] Missing or invalid phone for borrower ${col.borrowersId}`);
      }
    }
  }

  // Insert notifications into DB
  if (notifications.length > 0) {
    await notificationsCollection.insertMany(notifications);
    console.log(`✅ ${notifications.length} due payment notifications scheduled.`);
  }
}

// === Borrower payment confirmation ===
async function addBorrowerPaymentNotification(db, borrowersId, referenceNumber, amount, method) {
  const notificationsCollection = db.collection("borrower_notifications");
  const borrowersCollection = db.collection("borrowers_account");

  const message = `Your payment of ₱${amount.toLocaleString()} via ${method} for collection ${referenceNumber} has been recorded.`;

  const notification = {
    borrowersId,
    collectionRef: referenceNumber,
    message,
    read: false,
    viewed: false,
    createdAt: new Date(),
    notifyAt: new Date(),
  };

  await notificationsCollection.insertOne(notification);
  console.log(`💬 Borrower notification created: ${message}`);

  // Send SMS confirmation
  const borrower = await borrowersCollection.findOne({ borrowersId });
  const encryptedPhone = borrower?.appContact;
  let decryptedPhone = decrypt(encryptedPhone);
  if (!decryptedPhone && encryptedPhone) decryptedPhone = encryptedPhone;

  if (decryptedPhone) {
    const formattedPhone = formatPhoneNumber(decryptedPhone);
    await sendSMS(formattedPhone, message, "Gethsemane");
    console.log(`📩 Payment confirmation SMS sent to ${formattedPhone}`);
  } else {
    console.warn(`[SMS SKIPPED] Missing or invalid phone for borrower ${borrowersId}`);
  }
}

module.exports = {
  getBorrowerNotifications,
  markNotificationRead,
  markAllRoleRead,
  scheduleDueNotifications,
  addBorrowerPaymentNotification,
};
