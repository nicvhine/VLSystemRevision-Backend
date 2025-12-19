import dotenv from 'dotenv';
import cron from 'node-cron';
import { MongoClient } from 'mongodb';
import { sendSMS } from '../../services/smsService.js';

dotenv.config({ path: '../../.env' });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

// --- STATUS UPDATE FUNCTION ---
async function updateCollectionStatuses() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const collectionsCol = db.collection('collections');

    const collections = await collectionsCol.find({}).toArray();
    const now = new Date();
    let updatedCount = 0;

    for (const collection of collections) {
      const { dueDate, referenceNumber, status } = collection;
      if (!dueDate) continue;

      // Skip if already Paid
      if (status === 'Paid') continue;

      const due = new Date(dueDate);
      const daysLate = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

      let newStatus = status;

      if (status === 'Unpaid') {
        if (daysLate > 30) newStatus = 'Overdue';
        else if (daysLate > 3) newStatus = 'Past Due';
      } else if (status === 'Past Due' && daysLate > 30) {
        newStatus = 'Overdue';
      }

      if (newStatus !== status) {
        await collectionsCol.updateOne(
          { referenceNumber },
          { $set: { status: newStatus, lastStatusUpdated: now } }
        );
        updatedCount++;
        console.log(`Collection ${referenceNumber} status updated to "${newStatus}"`);
      }
    }

    console.log(`Updated ${updatedCount} collection status(es) at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('Error during status update:', err);
  } finally {
    await client.close();
  }
}

// --- DAILY SMS REMINDER FUNCTION ---
async function sendDailySMSReminders() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const collectionsCol = db.collection('collections');
    const borrowersCol = db.collection('borrowers_account');

    const collections = await collectionsCol.find({ status: { $in: ['Past Due', 'Overdue'] } }).toArray();
    const now = new Date();
    let smsCount = 0;

    for (const collection of collections) {
      const { status, borrowersId, referenceNumber, lastSMSSent } = collection;

      // Skip if SMS already sent today
      const lastSent = lastSMSSent ? new Date(lastSMSSent) : null;
      const sentToday =
        lastSent &&
        lastSent.getFullYear() === now.getFullYear() &&
        lastSent.getMonth() === now.getMonth() &&
        lastSent.getDate() === now.getDate();
      if (sentToday) continue;

      // Lookup borrower
      const borrower = await borrowersCol.findOne({ borrowersId });

      if (borrower && borrower.phoneNumber) {
        const { phoneNumber, name } = borrower;
        const message =
          status === 'Past Due'
            ? `Hello${name ? ' ' + name : ''}, your payment is PAST DUE. Please settle your account today to avoid penalties.`
            : `Hello${name ? ' ' + name : ''}, your account is OVERDUE. Please contact us immediately to prevent additional charges.`;

        try {
          await sendSMS(phoneNumber, message);
          smsCount++;

          // Update lastSMSSent timestamp
          await collectionsCol.updateOne(
            { referenceNumber },
            { $set: { lastSMSSent: now } }
          );

          console.log(`Sent ${status} SMS to ${name || 'Unknown'} (${phoneNumber})`);
        } catch (smsErr) {
          console.error(`Failed to send ${status} SMS to ${phoneNumber}:`, smsErr.message);
        }
      } else {
        console.warn(`⚠️ Borrower not found or missing phone number for borrowersId: ${borrowersId}`);
      }
    }

    console.log(`Sent ${smsCount} SMS reminders at ${now.toLocaleTimeString()}`);
  } catch (err) {
    console.error('Error during daily SMS reminders:', err);
  } finally {
    await client.close();
  }
}

// --- CRON SCHEDULES ---

// --- PRODUCTION ---
// Status update: daily at 12:00 AM
cron.schedule('0 0 * * *', updateCollectionStatuses);
console.log('Collection Status Updater scheduled at 12:00 AM daily');

// SMS reminders: daily at 9:00 AM
cron.schedule('0 9 * * *', sendDailySMSReminders);
console.log('Daily SMS reminders scheduled at 9:00 AM daily');

// --- TESTING (uncomment for testing) ---
// Run status update every 1 minute
// cron.schedule('*/1 * * * *', updateCollectionStatuses);
// console.log('Status updater scheduled every 1 minute (testing)');

// Run SMS reminders every 30 seconds
// cron.schedule('*/30 * * * * *', sendDailySMSReminders);
// console.log('SMS reminders scheduled every 30 seconds (testing)');
