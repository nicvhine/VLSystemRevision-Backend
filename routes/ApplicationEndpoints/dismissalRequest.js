const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const loanAppRepository = require("../../repositories/loanApplicationRepository");

module.exports = (db) => {
  const repo = loanAppRepository(db);
  const loanApplications = repo.loanApplications;

  /**
   * POST /loan-applications/:applicationId/dismissal-request
   * Borrower submits a dismissal request with reason and optional description
   * Only borrowers can submit dismissal requests
   */
  router.post("/:applicationId/dismissal-request", authenticateToken, authorizeRole("borrower"), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { dismissalReason, dismissalDescription } = req.body;

      if (!dismissalReason || dismissalReason.trim() === "") {
        return res.status(400).json({ error: "Dismissal reason is required" });
      }

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Only allow dismissal requests for Pending status
      if (application.status !== "Pending") {
        return res.status(400).json({ error: "Dismissal requests can only be submitted for applications in Pending status" });
      }

      // Update the application with dismissal request
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            pendingDismissalRequest: true,
            dismissalReason: dismissalReason.trim(),
            dismissalDescription: dismissalDescription?.trim() || "",
            dismissalRequestedAt: new Date(),
            dismissalRequestedBy: req.user.id,
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
      console.error("Error submitting dismissal request:", error);
      res.status(500).json({ error: "Failed to submit dismissal request" });
    }
  });

  /**
   * POST /loan-applications/:applicationId/approve-dismissal
   * Loan officer approves a dismissal request (changes status to Dismissed)
   * Only loan officers can approve dismissal requests
   */
  router.post("/:applicationId/approve-dismissal", authenticateToken, authorizeRole("loan officer", "manager"), async (req, res) => {
    try {
      const { applicationId } = req.params;

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Check if there's a pending dismissal request
      if (!application.pendingDismissalRequest) {
        return res.status(400).json({ error: "No pending dismissal request for this application" });
      }

      // Update the application to mark it as Dismissed
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            status: "Dismissed",
            pendingDismissalRequest: false,
            dismissalApprovedAt: new Date(),
            dismissalApprovedBy: req.user.id,
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
      console.error("Error approving dismissal request:", error);
      res.status(500).json({ error: "Failed to approve dismissal request" });
    }
  });

  /**
   * POST /loan-applications/:applicationId/reject-dismissal
   * Loan officer rejects a dismissal request (keeps application in Pending status)
   * Only loan officers can reject dismissal requests
   */
  router.post("/:applicationId/reject-dismissal", authenticateToken, authorizeRole("loan officer", "manager"), async (req, res) => {
    try {
      const { applicationId } = req.params;

      // Find the application
      const application = await repo.getApplicationById(applicationId);
      if (!application) {
        return res.status(404).json({ error: "Application not found" });
      }

      // Check if there's a pending dismissal request
      if (!application.pendingDismissalRequest) {
        return res.status(400).json({ error: "No pending dismissal request for this application" });
      }

      // Update the application to clear the pending dismissal request
      const result = await loanApplications.updateOne(
        { applicationId },
        {
          $set: {
            pendingDismissalRequest: false,
            dismissalReason: null,
            dismissalDescription: null,
            dismissalRequestedAt: null,
            dismissalRequestedBy: null,
            dismissalRejectedAt: new Date(),
            dismissalRejectedBy: req.user.id,
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
      console.error("Error rejecting dismissal request:", error);
      res.status(500).json({ error: "Failed to reject dismissal request" });
    }
  });

  return router;
};
