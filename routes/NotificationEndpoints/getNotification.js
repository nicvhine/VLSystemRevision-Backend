const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const notificationService = require("../../services/notificationService");

module.exports = (db) => {

  router.get("/:borrowersId", async (req, res) => {
    try {
      const { borrowersId } = req.params;
      if (!borrowersId) return res.status(400).json({ error: "borrowersId is required" });
  
      const now = new Date();
      const notificationsCollection = db.collection("borrower_notifications");
  
      // Show:
      // - notifications with NO schedule (instant)
      // - notifications where notifyAt <= now (due)
      const notifications = await notificationsCollection
        .find({
          borrowersId,
          $or: [
            { notifyAt: { $exists: false } },
            { notifyAt: { $lte: now } }
          ]
        })
        .sort({ createdAt: -1 })
        .toArray();
  
      res.json({ notifications });
    } catch (err) {
      console.error("Error fetching notifications:", err);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });
  

  // Staff notifications by role
  router.get(
    "/staff/:role",
    authenticateToken,
    authorizeRole("manager", "loan officer", "collector", "head"), 
    async (req, res) => {
      try {
        const role = (req.params.role || "").toLowerCase().trim();
        const userRole = (req.user?.role || "").toLowerCase().trim();
  
        let notifications;
  
        if (userRole === "head") {
          const loanOfficerNotifs = await notificationService.getLoanOfficerNotifications(db);
          const managerNotifs = await notificationService.getManagerNotifications(db);
          const collectorNotifs = await notificationService.getCollectorNotifications(db);
  
          notifications = [
            ...loanOfficerNotifs.map(n => ({ ...n, sourceRole: "loan officer" })),
            ...managerNotifs.map(n => ({ ...n, sourceRole: "manager" })),
            ...collectorNotifs.map(n => ({ ...n, sourceRole: "collector" })),
          ];
  
          return res.json({ notifications });
        }
  
        if (userRole !== role.replace("-", " ")) {
          return res.status(403).json({ error: "Access denied" });
        }
  
        if (role === "loan-officer") {
          notifications = await notificationService.getLoanOfficerNotifications(db);
        } else if (role === "manager") {
          notifications = await notificationService.getManagerNotifications(db);
        } else if (role === "collector") {

          const loggedInCollectorId = req.user?.userId;
        
          if (!loggedInCollectorId) {
            return res.status(400).json({ error: "Collector ID missing from token" });
          }
        
          const allCollectorNotifs = await notificationService.getCollectorNotifications(db);
        
          notifications = allCollectorNotifs.filter(
            notif => notif.collectorId === loggedInCollectorId
          );
        } else {
          return res.status(400).json({ error: "Invalid role" });
        }
  
        res.json({ notifications });
  
      } catch (err) {
        console.error("Error fetching notifications:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  
  
  
  return router;
};
