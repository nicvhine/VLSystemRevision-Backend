const cron = require("node-cron");
const { decrypt } = require("../../utils/crypt");
const notificationRepository = require("../../repositories/notificationRepository");

function startPendingApplicationCheckerProd(db) {
  cron.schedule("0 9 * * *", async () => {
    console.log("⏰ [PROD] Checking pending applications daily at 9AM...");

    try {
      const applications = db.collection("loan_applications");
      const notifRepo = notificationRepository(db);

      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const pendingApps = await applications
        .find({ status: { $in: ["Applied", "Pending", "Cleared"] } })
        .toArray();

      console.log(`[PROD] Found ${pendingApps.length} applications to check`);

      for (const app of pendingApps) {
        const applicationId = app.applicationId;
        let appName;
        try { appName = decrypt(app.appName) || app.appName || "Unknown"; } 
        catch { appName = app.appName || "Unknown"; }

        const status = app.status?.toLowerCase() || "unknown";

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

        const daysPending = Math.floor((new Date() - dateCheck) / (1000 * 60 * 60 * 24));

        let managerMessage = "", loanOfficerMessage = "";
        switch (status) {
          case "applied":
            managerMessage = `Application ${applicationId} from ${appName} has been "Applied" for ${daysPending} day(s) without an interview scheduled.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} is waiting for interview scheduling for ${daysPending} day(s). Please schedule the interview ASAP.`;
            break;
          case "pending":
            managerMessage = `Application ${applicationId} from ${appName} has been in "Pending" status for ${daysPending} day(s) with no follow-up.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} remains "Pending" for ${daysPending} day(s). Confirm interview completion and continue processing.`;
            break;
          case "cleared":
            managerMessage = `Application ${applicationId} from ${appName} has been "Cleared" for ${daysPending} day(s) without further action.`;
            loanOfficerMessage = `Application ${applicationId} from ${appName} is "Cleared" for ${daysPending} day(s). Follow up as required.`;
            break;
        }

        // Prevent duplicate notifications
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const existingManagerNotif = await db.collection("manager_notifications").findOne({
          type: "application-pending-3days",
          applicationId,
          createdAt: { $gte: startOfToday },
        });

        const existingLONotif = await db.collection("loanOfficer_notifications").findOne({
          type: "application-pending-3days",
          applicationId,
          createdAt: { $gte: startOfToday },
        });

        if (!existingManagerNotif) {
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
        }

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
        }

        console.log(`[PROD] Notifications processed for ${applicationId} (${status})`);
      }

      console.log("✅ [PROD] Pending application check completed");
    } catch (err) {
      console.error("❌ [PROD] Error checking pending applications:", err);
    }
  });

  console.log("🟢 [PROD] Pending application checker started (daily 9AM)");
}

module.exports = { startPendingApplicationCheckerProd };
