const express = require("express");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const penaltyEndorsementRepository = require("../../repositories/penaltyRespository");
const penaltyEndorsementServiceFactory = require("../../services/penaltyService");
const notificationRepository = require("../../repositories/notificationRepository");

const router = express.Router();

module.exports = (db) => {
  const repo = penaltyEndorsementRepository(db);
  const service = penaltyEndorsementServiceFactory(repo, db);
  const notifRepo = notificationRepository(db);

  router.post(
    "/endorse",
    authenticateToken,
    authorizeRole("collector"),
    express.json(),
    async (req, res) => {
      try {
        const { referenceNumber, reason, penaltyAmount, payableAmount } = req.body;
        const userId = req.user.id;
        const collectorName = req.user.name || "Collector";
  
        // find collection
        const collection = await db.collection("collections").findOne({ referenceNumber });
        if (!collection)
          return res.status(404).json({ message: "Collection not found" });
  
        // create penalty endorsement
        const result = await service.endorsePenalty(
          collection,
          { reason, penaltyAmount, payableAmount },
          userId
        );
  
        // --- NEW: mark collection as pendingPenalty ---
        await db.collection("collections").updateOne(
          { referenceNumber },
          { $set: { pendingPenalty: true } }
        );
  
        try {
          await notifRepo.insertLoanOfficerNotification({
            type: "penalty-endorsement",
            title: "New Penalty Endorsement",
            message: `${collectorName} endorsed penalty for collection ${referenceNumber}.`,
            referenceNumber,
            actor: { name: collectorName, role: "Collector" },
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
  
          await notifRepo.insertBorrowerNotifications([{
            borrowersId: collection.borrowersId,
            type: "penalty-endorsed",
            title: "Penalty Review Notification",
            message: `Your account for collection reference ${referenceNumber} has been forwarded for penalty assessment review. Proposed penalty amount: ₱${penaltyAmount.toLocaleString()}. Please contact our office for more information.`,
            referenceNumber,
            amount: penaltyAmount,
            read: false,
            viewed: false,
            createdAt: new Date(),
          }]);
  
          console.log("Loan officer and borrower notified of penalty endorsement.");
        } catch (notifyErr) {
          console.error("Failed to notify about penalty endorsement:", notifyErr.message);
        }
  
        res.status(201).json({
          message: "Penalty endorsement created, collection marked pendingPenalty, and notifications sent",
          ...result,
        });
      } catch (error) {
        console.error("Error endorsing penalty:", error);
        res.status(500).json({ message: "Server error endorsing penalty" });
      }
    }
  );
  

  return router;
};
