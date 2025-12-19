import dotenv from 'dotenv';
import cron from 'node-cron';
import { MongoClient } from 'mongodb';
import { sendSMS } from '../../services/smsService.js';
import { decrypt } from '../../utils/crypt.js'

dotenv.config({ path: '../../.env' });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

// --- STATUS UPDATE (TEST) ---
async function updateCollectionStatusesTest() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collectionsCol = db.collection('collections');
    const now = new Date();
    let updatedCount = 0;

    const collections = await collectionsCol.find({}).toArray();

    for (const col of collections) {
      const { dueDate, referenceNumber, status } = col;
      if (!dueDate || status === 'Paid') continue;

      const due = new Date(dueDate);
      const daysLate = Math.floor((now - due) / (1000 * 60)); 
      let newStatus = status;

      // Status logic with grace period (simulating 3 days)
      if ((status === 'Unpaid' || status === 'Partial') && daysLate > 3 && daysLate < 30) {
        newStatus = 'Past Due';
      } else if ((status === 'Unpaid' || status === 'Partial' || status === 'Past Due') && daysLate >= 30) {
        newStatus = 'Overdue';
      }
      // Within 3-minute grace period: status remains 'Unpaid' or 'Partial'

      if (newStatus !== status) {
        await collectionsCol.updateOne({ referenceNumber }, { $set: { status: newStatus, lastStatusUpdated: now } });
        updatedCount++;
        console.log(`[TEST] Collection ${referenceNumber} status updated to "${newStatus}"`);
      }
    }

    console.log(`[TEST] Updated ${updatedCount} collection(s) at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('[TEST] Error during status update:', err);
  } finally {
    await client.close();
  }
}

// --- SMS REMINDERS (TEST) ---
async function sendDailySMSRemindersTest() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collectionsCol = db.collection('collections');
    const borrowersCol = db.collection('borrowers_account');
    const now = new Date();
    let smsCount = 0;

    const collections = await collectionsCol.find({ status: { $in: ['Past Due', 'Overdue'] } }).toArray();

    for (const col of collections) {
      const { status, borrowersId, referenceNumber, lastSMSSent } = col;

      const lastSent = lastSMSSent ? new Date(lastSMSSent) : null;
      const sentToday = lastSent && now.getTime() - lastSent.getTime() < 30 * 1000; // 30 sec window for testing
      if (sentToday) continue;

      const borrower = await borrowersCol.findOne({ borrowersId });
      if (borrower) {
        // Decrypt phone number and name
        let decryptedPhone = borrower.phoneNumber ? decrypt(borrower.phoneNumber) : null;
        let decryptedName = borrower.name ? decrypt(borrower.name) : null;

        // Fallback if decryption fails
        decryptedPhone = decryptedPhone || borrower.phoneNumber;
        decryptedName = decryptedName || borrower.name;

        if (!decryptedPhone) {
          console.warn(`[TEST] ⚠️ Missing phone number for borrowersId: ${borrowersId}`);
          continue;
        }

        const message =
          status === 'Past Due'
            ? `[TEST] Hello${decryptedName ? ' ' + decryptedName : ''}, your payment is PAST DUE.`
            : `[TEST] Hello${decryptedName ? ' ' + decryptedName : ''}, your account is OVERDUE.`;

        try {
          await sendSMS(decryptedPhone, message);
          smsCount++;
          await collectionsCol.updateOne({ referenceNumber }, { $set: { lastSMSSent: now } });
          console.log(`[TEST] Sent ${status} SMS to ${decryptedName || 'Unknown'} (${decryptedPhone})`);
        } catch (smsErr) {
          console.error(`[TEST] Failed SMS to ${decryptedPhone}:`, smsErr.message);
        }
      }
    }

    console.log(`[TEST] Sent ${smsCount} SMS reminder(s) at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('[TEST] Error during SMS reminders:', err);
  } finally {
    await client.close();
  }
}

// --- TEST CRON ---
cron.schedule('*/1 * * * *', updateCollectionStatusesTest); // every minute
cron.schedule('*/30 * * * * *', sendDailySMSRemindersTest); // every 30 sec
console.log('✅ TEST cron jobs scheduled: status updater (1 min) & SMS reminders (30 sec)');