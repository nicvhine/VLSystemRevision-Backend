import dotenv from 'dotenv';
import cron from 'node-cron';
import { MongoClient } from 'mongodb';
import { sendSMS } from '../../services/smsService.js';
import { decrypt } from '../../utils/crypt.js';

dotenv.config({ path: '../../.env' });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

// --- STATUS UPDATE ---
async function updateCollectionStatuses() {
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
      const daysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
      let newStatus = status;

      // Status logic with 3-day grace period
      if ((status === 'Unpaid' || status === 'Partial') && daysLate > 3 && daysLate < 30) {
        newStatus = 'Past Due';
      } else if ((status === 'Unpaid' || status === 'Partial' || status === 'Past Due') && daysLate >= 30) {
        newStatus = 'Overdue';
      }
      // Within 3-day grace period: status remains 'Unpaid' or 'Partial'

      if (newStatus !== status) {
        await collectionsCol.updateOne({ referenceNumber }, { $set: { status: newStatus, lastStatusUpdated: now } });
        updatedCount++;
        console.log(`Collection ${referenceNumber} status updated to "${newStatus}"`);
      }
    }

    console.log(`✅ Updated ${updatedCount} collection(s) at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('Error during status update:', err);
  } finally {
    await client.close();
  }
}

// --- DAILY SMS REMINDERS ---
async function sendDailySMSReminders() {
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
      const sentToday =
        lastSent &&
        lastSent.getFullYear() === now.getFullYear() &&
        lastSent.getMonth() === now.getMonth() &&
        lastSent.getDate() === now.getDate();
      if (sentToday) continue;

      const borrower = await borrowersCol.findOne({ borrowersId });
      if (borrower) {

        let decryptedPhone = borrower.phoneNumber ? decrypt(borrower.phoneNumber) : null;
        let decryptedName = borrower.name ? decrypt(borrower.name) : null;

        // Fallback if decryption fails
        decryptedPhone = decryptedPhone || borrower.phoneNumber;
        decryptedName = decryptedName || borrower.name;

        const message =
          status === 'Past Due'
            ? `Hello${decryptedName ? ' ' + decryptedName : ''}, your payment is PAST DUE. Please settle today.`
            : `Hello${decryptedName ? ' ' + decryptedName : ''}, your account is OVERDUE. Please contact us immediately.`;

        try {
          await sendSMS(decryptedPhone, message);
          smsCount++;
          await collectionsCol.updateOne({ referenceNumber }, { $set: { lastSMSSent: now } });
          console.log(`Sent ${status} SMS to ${decryptedName || 'Unknown'} (${decryptedPhone})`);
        } catch (smsErr) {
          console.error(`Failed to send SMS to ${decryptedPhone}:`, smsErr.message);
        }
      }
    }

    console.log(`✅ Sent ${smsCount} SMS reminder(s) at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('Error during daily SMS reminders:', err);
  } finally {
    await client.close();
  }
}

// --- CRON ---
cron.schedule('0 0 * * *', updateCollectionStatuses); // daily at midnight
cron.schedule('0 9 * * *', sendDailySMSReminders); // daily at 9 AM
console.log('✅ PROD cron jobs scheduled: status updater (00:00) & SMS reminders (09:00)');