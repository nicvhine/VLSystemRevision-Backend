const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const loanAppRepository = require("../../repositories/loanApplicationRepository");

module.exports = (db) => {
  const repo = loanAppRepository(db);  const loanApplications = repo.loanApplications;
  /**
   * POST /loan-applications/:applicationId/withdrawal-request
   * Borrower submits a withdrawal request with reason
   * Only borrowers can submit withdrawal requests
   */
  router.post("/:applicationId/withdrawal-request", authenticateToken, authorizeRole("borrower"), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { withdrawalReason } = req.body;

      if (!withdrawalReason || withdrawalReason.trim() === "") {
        return res.status(400).json({ error: "Withdrawal reason is required" });
      }

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Only allow withdrawal requests for Applied status
      if (application.status !== "Applied") {
        return res.status(400).json({ error: "Withdrawal requests can only be submitted for applications in Applied status" });
      }

      // Update the application with withdrawal request
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            pendingWithdrawalRequest: true,
            withdrawalReason: withdrawalReason.trim(),
            withdrawalRequestedAt: new Date(),
            withdrawalRequestedBy: req.user.id,
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(500).json({ error: "Failed to update application" });
      }

      // Return updated application
      const updatedApp = await repo.getApplicationById(applicationId);
      res.status(200).json(updatedApp);
    } catch (error) {
      console.error("Error submitting withdrawal request:", error);
      res.status(500).json({ error: "Failed to submit withdrawal request" });
    }
  });

  /**
   * POST /loan-applications/:applicationId/approve-withdrawal
   * Loan officer approves a withdrawal request
   * Only loan officers can approve withdrawal requests
   */
  router.post("/:applicationId/approve-withdrawal", authenticateToken, authorizeRole("loan officer", "manager"), async (req, res) => {
    try {
      const { applicationId } = req.params;

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Check if there's a pending withdrawal request
      if (!application.pendingWithdrawalRequest) {
        return res.status(400).json({ error: "No pending withdrawal request for this application" });
      }

      // Update the application
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            status: "Withdrawn",
            pendingWithdrawalRequest: false,
            withdrawalApprovedAt: new Date(),
            withdrawalApprovedBy: req.user.id,
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(500).json({ error: "Failed to update application" });
      }

      // Return updated application
      const updatedApp = await repo.getApplicationById(applicationId);
      res.status(200).json(updatedApp);
    } catch (error) {
      console.error("Error approving withdrawal:", error);
      res.status(500).json({ error: "Failed to approve withdrawal" });
    }
  });

  /**
   * POST /loan-applications/:applicationId/deny-withdrawal
   * Loan officer denies a withdrawal request
   * Only loan officers can deny withdrawal requests
   */
  router.post("/:applicationId/deny-withdrawal", authenticateToken, authorizeRole("loan officer", "manager"), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { denialReason } = req.body;

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Check if there's a pending withdrawal request
      if (!application.pendingWithdrawalRequest) {
        return res.status(400).json({ error: "No pending withdrawal request for this application" });
      }

      // Update the application
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            pendingWithdrawalRequest: false,
            withdrawalDeniedAt: new Date(),
            withdrawalDeniedBy: req.user.id,
            withdrawalDenialReason: denialReason || "Request denied by loan officer",
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(500).json({ error: "Failed to update application" });
      }

      // Return updated application
      const updatedApp = await repo.getApplicationById(applicationId);
      res.status(200).json(updatedApp);
    } catch (error) {
      console.error("Error denying withdrawal:", error);
      res.status(500).json({ error: "Failed to deny withdrawal" });
    }
  });

  return router;
};
