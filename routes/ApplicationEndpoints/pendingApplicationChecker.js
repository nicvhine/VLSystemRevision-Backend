const cron = require("node-cron");
const notificationRepository = require("../../repositories/notificationRepository");
const { decrypt } = require("../../utils/crypt");

function startPendingApplicationChecker(db) {
  cron.schedule("*/30 * * * * *", async () => {
    console.log("⏰ Checking for pending applications (TEST every 30 seconds)...");

    try {
      const applications = db.collection("loan_applications");
      const notifRepo = notificationRepository(db);

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const pendingApps = await applications
        .find({
          status: { $in: ["Applied", "Pending", "Cleared"] },
        })
        .toArray();

      console.log(`📋 Found ${pendingApps.length} applications to check`);

      for (const app of pendingApps) {
        const applicationId = app.applicationId;
        let appName;
        try {
          appName = decrypt(app.appName) || app.appName || "Unknown";
        } catch {
          appName = app.appName || "Unknown";
        }

        const status = app.status?.toLowerCase() || "unknown";

        // Determine the relevant date field
        let relevantDate;
        switch (status) {
          case "applied":
            relevantDate = app.dateApplied;
            break;
          case "pending":
            relevantDate = app.dateScheduled;
            break;
          case "cleared":
            relevantDate = app.dateCleared;
            break;
          default:
            relevantDate = app.dateApplied;
        }

        if (!relevantDate) continue;

        const dateCheck = new Date(relevantDate);
        if (dateCheck > threeDaysAgo) continue; // not yet 3 days

        // Messages
        let managerMessage = "";
        let loanOfficerMessage = "";

        switch (status) {
          case "cleared":
            managerMessage = `Application ${applicationId} from ${appName} has been in "Cleared" status for 3+ days without review.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} has been in "Cleared" status for 3+ days.`;
            break;
          case "applied":
            managerMessage = `Application ${applicationId} from ${appName} has been "Applied" for 3+ days without scheduling.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} waiting for interview scheduling for 3+ days.`;
            break;
          case "pending":
            managerMessage = `Application ${applicationId} from ${appName} has been "Pending" for 3+ days with no follow-up.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} pending for 3+ days. Please confirm interview completion.`;
            break;
        }

        if (!managerMessage || !loanOfficerMessage) continue;

        // // Prevent duplicates per day
        // const existingNotif = await db.collection("manager_notifications").findOne({
        //   type: "application-pending-3days",
        //   applicationId,
        //   createdAt: { $gte: startOfToday },
        // });

        if (!existingNotif) {
          await notifRepo.insertManagerNotification({
            type: "application-pending-3days",
            title: "Application Requires Attention",
            message: managerMessage,
            applicationId,
            status,
            actor: "System",
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
          console.log(`✅ Manager notified: ${applicationId} (${status})`);
        }

        const existingLONotif = await db.collection("loanOfficer_notifications").findOne({
          type: "application-pending-3days",
          applicationId,
          createdAt: { $gte: startOfToday },
        });

        if (!existingLONotif) {
          await notifRepo.insertLoanOfficerNotification({
            type: "application-pending-3days",
            title: "Action Required: Pending Application",
            message: loanOfficerMessage,
            applicationId,
            status,
            actor: "System",
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
          console.log(`✅ Loan Officer notified: ${applicationId} (${status})`);
        }
      }

      console.log("✅ Pending application check completed");
    } catch (err) {
      console.error("❌ Error checking pending applications:", err);
    }
  });

  console.log("🟢 Pending application checker scheduled (TEST mode)");
}

module.exports = { startPendingApplicationChecker };
