require('dotenv').config();
const cron = require('node-cron');
const { MongoClient } = require('mongodb');
const { sendSMS, formatPhoneNumber } = require('../../services/smsService');
const { decrypt } = require('../../utils/crypt');

const uri = process.env.MONGODB_URI;

async function cleanupPendingApplicationsProd() {
  const now = new Date();
  console.log(`[${now.toLocaleString()}] [PROD] Running auto-deny for stale applications...`);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "VLSystem");

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    console.log(`[PROD] Looking for 'Applied' applications older than ${cutoff.toISOString()}`);

    const oldApplications = await db
      .collection('loan_applications')
      .find({ status: 'Applied', dateApplied: { $lte: cutoff } })
      .toArray();

    if (!oldApplications.length) return console.log(`[PROD] No stale 'Applied' applications found.`);

    await db.collection('loan_applications').updateMany(
      { status: 'Applied', dateApplied: { $lte: cutoff } },
      {
        $set: {
          status: 'Denied',
          denialReason: 'Automatically denied due to 7 days of inactivity',
          dateDenied: new Date(),
        },
      }
    );

    console.log(`[PROD] Marked ${oldApplications.length} applications as 'Denied'.`);

    for (const app of oldApplications) {
      try {
        const notification = {
          userId: app.createdBy || "system",
          actor: { id: "system", name: "System", username: "system" },
          message: `Loan application ${app.applicationId} automatically denied after 7 days.`,
          read: false,
          viewed: false,
          createdAt: new Date(),
          notifyAt: new Date(),
        };
        await db.collection('loanOfficer_notifications').insertOne(notification);

        const decryptedPhone = decrypt(app.appContact);
        if (decryptedPhone) {
          const formattedPhone = formatPhoneNumber(decryptedPhone);
          const message = `Your loan application (${app.applicationId}) was automatically denied due to 7 days of inactivity.`;
          await sendSMS(formattedPhone, message, "Gethsemane");
          console.log(`[PROD] SMS sent to ${formattedPhone}`);
        }
      } catch (smsErr) {
        console.error(`[PROD] Failed SMS for ${app.applicationId}:`, smsErr.message);
      }
    }
  } catch (err) {
    console.error(`[PROD] Error in cleanupPendingApplicationsProd:`, err);
  } finally {
    await client.close();
    console.log(`[PROD] Database connection closed.`);
  }
}

// Run daily at midnight
cron.schedule('0 0 * * *', cleanupPendingApplicationsProd);
console.log('[PROD] Auto-deny cron job scheduled: runs daily at 00:00.');
