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

  // PUT - Approve
  router.put("/:id/approve", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks } = req.body;
      const approverId = req.user.id;
      const approverName = req.user.name || "Loan Officer";

      const result = await service.approveEndorsement(id, approverId, remarks);

      try {
        const endorsement = await repo.getById(id);
        if (endorsement?.collectorId) {
          await notifRepo.insertCollectorNotification({
            type: "penalty-endorsement-approved",
            title: "Penalty Endorsement Approved",
            message: `Your penalty endorsement for collection ${endorsement.referenceNumber} has been approved by ${approverName}.`,
            referenceNumber: endorsement.referenceNumber,
            actor: approverName,
            collectorId: endorsement.collectorId,
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
        }
      } catch (notifyErr) {
        console.error("Failed to notify collector (approval):", notifyErr);
      }

      res.json({ message: "Endorsement approved successfully", ...result });
    } catch (error) {
      console.error("Error approving endorsement:", error);
      res.status(500).json({ message: "Server error approving endorsement" });
    }
  });

  // PUT - Reject
  router.put("/:id/reject", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks } = req.body;
      const approverId = req.user.id;
      const approverName = req.user.name || "Loan Officer";

      const result = await service.rejectEndorsement(id, approverId, remarks);

      try {
        const endorsement = await repo.getById(id);
        if (endorsement?.collectorId) {
          await notifRepo.insertCollectorNotification({
            type: "penalty-endorsement-rejected",
            title: "Penalty Endorsement Rejected",
            message: `Your penalty endorsement for collection ${endorsement.referenceNumber} has been rejected by ${approverName}.`,
            referenceNumber: endorsement.referenceNumber,
            actor: approverName,
            collectorId: endorsement.collectorId,
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
        }
      } catch (notifyErr) {
        console.error("Failed to notify collector (rejection):", notifyErr);
      }

      res.json({ message: "Endorsement rejected successfully", ...result });
    } catch (error) {
      console.error("Error rejecting endorsement:", error);
      res.status(500).json({ message: "Server error rejecting endorsement" });
    }
  });

  return router;
};
