const express = require("express");
const router = express.Router();
const ClosureService = require("../../services/closureService");
const notificationRepository = require("../../repositories/notificationRepository");

module.exports = (db) => {
  const service = ClosureService(db);
  const notifRepo = notificationRepository(db); 

  router.post("/", async (req, res) => {
    try {
      const { clientName, reason, date, authorizedBy, loanId } = req.body;
      if (!loanId) throw new Error("Loan ID is required");

      const result = await service.createClosure({
        clientName,
        reason,
        date,
        authorizedBy,
        loanId,
      });

      res.status(201).json({
        message: "Closure created successfully",
        data: result,
      });

      try {
        await notifRepo.insertManagerNotification({
          type: "closure-endorsement",
          title: "New Loan Endorsed for Closure",
          message: `${authorizedBy} has endorsed loan ${loanId} for closure.`,
          loanId,
          actor: {
            name: authorizedBy,
            role: "Loan Officer",
          },
          read: false,
          viewed: false,
          createdAt: new Date(),
        });

        // Notify borrower about closure endorsement
        const loan = await db.collection("loans").findOne({ loanId });
        if (loan?.borrowersId) {
          await notifRepo.insertBorrowerNotifications([{
            borrowersId: loan.borrowersId,
            type: "closure-endorsed",
            title: "Account Closure Under Review",
            message: `Your loan account (${loanId}) has been submitted for closure review. Our management team will process your request accordingly. You will be notified once a decision has been made.`,
            loanId,
            read: false,
            viewed: false,
            createdAt: new Date(),
          }]);
        }

        console.log("Manager and borrower notified about closure endorsement.");
      } catch (notifyErr) {
        console.error("Failed to create notifications:", notifyErr.message);
      }
    } catch (err) {
      console.error("Error creating endorsement:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};
