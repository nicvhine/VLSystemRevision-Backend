require('dotenv').config();
const cron = require('node-cron');
const { MongoClient } = require('mongodb');
const { sendSMS, formatPhoneNumber } = require('../../services/smsService');
const { decrypt } = require('../../utils/crypt');

const uri = process.env.MONGODB_URI;

async function cleanupPendingApplicationsTest() {
  const now = new Date();
  console.log(`[${now.toLocaleString()}] [TEST] Running auto-deny for stale applications...`);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "VLSystem");

    // Cutoff = 30 seconds ago
    const cutoff = new Date(Date.now() - 30 * 1000);
    console.log(`[TEST] Looking for 'Applied' applications older than ${cutoff.toISOString()}`);

    const oldApplications = await db
      .collection('loan_applications')
      .find({ status: 'Applied', dateApplied: { $lte: cutoff } })
      .toArray();

    if (!oldApplications.length) return console.log(`[TEST] No stale 'Applied' applications found.`);

    await db.collection('loan_applications').updateMany(
      { status: 'Applied', dateApplied: { $lte: cutoff } },
      {
        $set: {
          status: 'Denied',
          denialReason: 'Automatically denied due to inactivity (TEST)',
          dateDenied: new Date(),
        },
      }
    );

    console.log(`[TEST] Marked ${oldApplications.length} applications as 'Denied'.`);

    for (const app of oldApplications) {
      try {
        const notification = {
          userId: app.createdBy || "system",
          actor: { id: "system", name: "System", username: "system" },
          message: `[TEST] Loan application ${app.applicationId} automatically denied.`,
          read: false,
          viewed: false,
          createdAt: new Date(),
          notifyAt: new Date(),
        };
        await db.collection('loanOfficer_notifications').insertOne(notification);

        const decryptedPhone = decrypt(app.appContact);
        if (decryptedPhone) {
          const formattedPhone = formatPhoneNumber(decryptedPhone);
          const message = `[TEST] Your loan application (${app.applicationId}) was automatically denied due to inactivity.`;
          await sendSMS(formattedPhone, message, "Gethsemane");
          console.log(`[TEST] SMS sent to ${formattedPhone}`);
        }
      } catch (smsErr) {
        console.error(`[TEST] Failed SMS for ${app.applicationId}:`, smsErr.message);
      }
    }
  } catch (err) {
    console.error(`[TEST] Error in cleanupPendingApplicationsTest:`, err);
  } finally {
    await client.close();
    console.log(`[TEST] Database connection closed.`);
  }
}

// Run every 30 seconds for testing
cron.schedule('*/30 * * * * *', cleanupPendingApplicationsTest);
console.log('[TEST] Auto-deny cron job scheduled: runs every 30 seconds.');
