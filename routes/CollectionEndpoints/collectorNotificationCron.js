const cron = require("node-cron");
const notificationRepository = require("../../repositories/notificationRepository");


function startCollectorNotificationCron(db) {
  // Run daily at 9:00 AM
  cron.schedule("0 9 * * *", async () => {
    console.log("⏰ Checking collector notifications...");
    
    try {
      const collections = db.collection("collections");
      const notifRepo = notificationRepository(db);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Calculate 3 days from now for reminders
      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      threeDaysFromNow.setHours(23, 59, 59, 999);

      // Find collections due in 3 days (unpaid)
      const upcomingCollections = await collections
        .find({
          dueDate: {
            $gte: threeDaysFromNow,
            $lt: new Date(threeDaysFromNow.getTime() + 24 * 60 * 60 * 1000),
          },
          status: "Unpaid",
          collectorId: { $exists: true, $ne: "" },
        })
        .toArray();

      console.log(`📋 Found ${upcomingCollections.length} collections due in 3 days`);

      // Group by collector
      const collectorGroups = {};
      for (const collection of upcomingCollections) {
        const collectorId = collection.collectorId;
        if (!collectorGroups[collectorId]) {
          collectorGroups[collectorId] = [];
        }
        collectorGroups[collectorId].push(collection);
      }

      // Send reminder notifications to collectors
      for (const [collectorId, collectorCollections] of Object.entries(collectorGroups)) {
        for (const collection of collectorCollections) {
          // Check if reminder already sent
          const existingReminder = await db.collection("collector_notifications").findOne({
            type: "payment-reminder-3days",
            referenceNumber: collection.referenceNumber,
            createdAt: { $gte: today },
          });

          if (!existingReminder) {
            await notifRepo.insertCollectorNotification({
              type: "payment-reminder-3days",
              title: "Upcoming Payment Due",
              message: `Payment follow-up required: Borrower account ${collection.borrowersId} has a payment of ₱${collection.periodAmount.toLocaleString()} due in 3 days (Collection Ref: ${collection.referenceNumber}). Please coordinate with the borrower for timely payment.`,
              referenceNumber: collection.referenceNumber,
              borrowersId: collection.borrowersId,
              amount: collection.periodAmount,
              dueDate: collection.dueDate,
              actor: "System",
              read: false,
              viewed: false,
              createdAt: new Date(),
            });
          }
        }
        
        console.log(`✅ Sent ${collectorCollections.length} reminder(s) to collector ${collectorId}`);
      }

      // Find overdue collections
      const overdueCollections = await collections
        .find({
          dueDate: { $lt: today },
          status: "Unpaid",
          collectorId: { $exists: true, $ne: "" },
        })
        .toArray();

      console.log(`📋 Found ${overdueCollections.length} overdue collections`);

      // Group overdue by collector
      const overdueGroups = {};
      for (const collection of overdueCollections) {
        const collectorId = collection.collectorId;
        if (!overdueGroups[collectorId]) {
          overdueGroups[collectorId] = [];
        }
        overdueGroups[collectorId].push(collection);
      }

      // Send overdue notifications
      for (const [collectorId, collectorCollections] of Object.entries(overdueGroups)) {
        for (const collection of collectorCollections) {
          const daysOverdue = Math.floor((today - new Date(collection.dueDate)) / (1000 * 60 * 60 * 24));

          // Check if overdue notification already sent today
          const existingOverdue = await db.collection("collector_notifications").findOne({
            type: "payment-overdue",
            referenceNumber: collection.referenceNumber,
            createdAt: { $gte: today },
          });

          if (!existingOverdue) {
            await notifRepo.insertCollectorNotification({
              type: "payment-overdue",
              title: "Overdue Payment Alert",
              message: `Collection reference ${collection.referenceNumber} is now ${daysOverdue} day(s) overdue. Borrower account ${collection.borrowersId} has an outstanding balance of ₱${collection.periodAmount.toLocaleString()}. Immediate follow-up action required.`,
              referenceNumber: collection.referenceNumber,
              borrowersId: collection.borrowersId,
              amount: collection.periodAmount,
              dueDate: collection.dueDate,
              daysOverdue,
              actor: "System",
              read: false,
              viewed: false,
              createdAt: new Date(),
            });
          }
        }
        
        console.log(`✅ Sent ${collectorCollections.length} overdue notification(s) to collector ${collectorId}`);
      }

      console.log("✅ Collector notification check completed");
    } catch (err) {
      console.error("❌ Error in collector notification cron:", err);
    }
  });

  console.log("🟢 Collector notification cron scheduled (daily at 9:00 AM)");
}

module.exports = { startCollectorNotificationCron };
