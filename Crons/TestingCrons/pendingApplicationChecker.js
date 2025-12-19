const cron = require("node-cron");
const { decrypt } = require("../../utils/crypt");
const notificationRepository = require("../../repositories/notificationRepository");

function startPendingApplicationCheckerTest(db) {
  cron.schedule("*/30 * * * * *", async () => {
    console.log("⏰ [TEST] Checking pending applications every 30 seconds...");

    try {
      const applications = db.collection("loan_applications");
      const notifRepo = notificationRepository(db);
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const pendingApps = await applications
        .find({ status: { $in: ["Applied", "Pending", "Cleared"] } })
        .toArray();

      console.log(`[TEST] Found ${pendingApps.length} applications to check`);

      for (const app of pendingApps) {
        const applicationId = app.applicationId;
        let appName;
        try { appName = decrypt(app.appName) || app.appName || "Unknown"; } 
        catch { appName = app.appName || "Unknown"; }

        const status = app.status?.toLowerCase() || "unknown";

        // Determine relevant date
        let relevantDate;
        switch (status) {
          case "applied": relevantDate = app.dateApplied; break;
          case "pending": relevantDate = app.dateScheduled; break;
          case "cleared": relevantDate = app.dateCleared; break;
          default: relevantDate = app.dateApplied;
        }

        if (!relevantDate) continue;
        const dateCheck = new Date(relevantDate);
        if (dateCheck > threeDaysAgo) continue; 

        // Messages
        let managerMessage = "", loanOfficerMessage = "";
        switch (status) {
          case "applied":
            managerMessage = `Application ${applicationId} from ${appName} has been "Applied" for 3 days without scheduling.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} needs interview scheduling.`;
            break;
          case "pending":
            managerMessage = `Application ${applicationId} from ${appName} is "Pending" for 3 days with no follow-up.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} is pending for 3 days.`;
            break;
          case "cleared":
            managerMessage = `Application ${applicationId} from ${appName} is "Cleared" for 3 days.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} is cleared for 3 days.`;
            break;
        }

        // Insert notifications
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

        console.log(`[TEST] Notifications sent for ${applicationId} (${status})`);
      }

      console.log("✅ [TEST] Pending application check completed");
    } catch (err) {
      console.error("❌ [TEST] Error checking pending applications:", err);
    }
  });

  console.log("🟢 [TEST] Pending application checker started (every 30s)");
}

module.exports = { startPendingApplicationCheckerTest };
