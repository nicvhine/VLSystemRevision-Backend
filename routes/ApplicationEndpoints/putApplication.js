  const express = require('express');
  const router = express.Router();
  const authenticateToken = require('../../middleware/auth');
  const authorizeRole = require('../../middleware/authorizeRole');
  const { computeLoanFields } = require('../../services/loanApplicationService');
  const LogRepository = require('../../repositories/logRepository');
  const { sendSMS, formatPhoneNumber } = require('../../services/smsService');
  const { decrypt } = require("../../utils/crypt");

  const loanOptions = {
    withCollateral: [
      { amount: 20000, months: 8, interest: 7 },
      { amount: 50000, months: 10, interest: 5 },
      { amount: 100000, months: 18, interest: 4 },
      { amount: 200000, months: 24, interest: 3 },
      { amount: 300000, months: 36, interest: 2 },
      { amount: 500000, months: 60, interest: 1.5 },
    ],
    withoutCollateral: [
      { amount: 10000, months: 5, interest: 10 },
      { amount: 15000, months: 6, interest: 10 },
      { amount: 20000, months: 8, interest: 10 },
      { amount: 30000, months: 10, interest: 10 },
    ],
    openTerm: [
      { amount: 50000, interest: 6 },
      { amount: 100000, interest: 5 },
      { amount: 200000, interest: 4 },
      { amount: 500000, interest: 3 },
    ],
  };

  module.exports = (db) => {
    const loanApplications = db.collection("loan_applications");
    const collection = db.collection("collections");
    const logRepo = LogRepository(db);

    router.put("/:applicationId", authenticateToken, authorizeRole("manager", "loan officer", "borrower"), async (req, res) => {
      try {
        const { applicationId } = req.params;
        let updateData = req.body;

        // Remove immutable fields
        delete updateData._id;
        delete updateData.applicationId;
        delete updateData.dateApplied;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        // Add pending date if status is "Pending"
        if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "pending") {
          updateData.dateScheduled = new Date();
        }

        // Add cleared date if status is "Cleared"
        if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "cleared") {
          updateData.dateCleared = new Date();
        }

        // Add cleared date if status is "Approved"
        if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "approved") {
          updateData.dateApproved = new Date();
        }

        // Add disbursed date if status is "Disbursed"
        if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "disbursed") {
          updateData.dateDisbursed = new Date();
        }

        const agents = db.collection("agents");
        const existingApp = await loanApplications.findOne({ applicationId });
        if (!existingApp) return res.status(404).json({ error: "Loan application not found." });

        await loanApplications.updateOne({ applicationId }, { $set: updateData });
        const updatedDoc = await loanApplications.findOne({ applicationId });

        const creatorName = req.user.name;

        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: creatorName,
          role: req.user.role,
          action: "UPDATE_LOAN_APPLICATION",
          description: `${creatorName} updated loan application ${applicationId}: ${JSON.stringify(updateData)}`,
        });

        res.status(200).json({
          ...updatedDoc,
          _debug: { statusUpdated: true },
        });

        // Async post-update: update agent stats & notify
        (async () => {
          try {
            // Update agent stats if disbursed
            if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "disbursed") {
              const appAgent = existingApp.appAgent;
              const loanAmount = parseFloat(existingApp.appLoanAmount || 0);

              if (appAgent && (appAgent.agentId || appAgent.id)) {
                const agentId = appAgent.agentId || appAgent.id;
                const commissionRate = 0.05;
                const commission = loanAmount * commissionRate;

                await agents.updateOne(
                  { agentId },
                  { $inc: { handledLoans: 1, totalLoanAmount: loanAmount, totalCommission: commission } }
                );

                console.log(`[AGENT UPDATE] Updated agent ${agentId}`);
              }
            }

            // If status changed to "Approved", send SMS notification to borrower
            if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "approved") {
              try {
                let phone = existingApp.appContact;

                if (phone && typeof phone === "string") {
                  phone = decrypt(phone);
                }
            
                console.log("[DEBUG] Decrypted borrower phone:", phone);

                if (phone) {
                  const formattedPhone = formatPhoneNumber(phone);
                  const message = `Your loan application ${applicationId} has been approved! Please stay alert for calls or updates regarding the disbursement process. You can expect disbursement within 3 business days.`;

                  await sendSMS(formattedPhone, message, "Gethsemane");
                  console.log(`Loan approval SMS sent to ${formattedPhone}`);
                } else {
                  console.warn(`[SMS SKIPPED] No phone number found for borrower of application ${applicationId}`);
                }
              } catch (smsErr) {
                console.error(`[SMS ERROR] Failed to send approval SMS:`, smsErr.message);
              }
            }

            // If status changed to "Denied", send SMS notification to borrower
            if (typeof updateData.status === "string" && updateData.status.trim().toLowerCase() === "denied" || updateData.status.trim().toLowerCase() === "denied by lo") {
              try {
                let phone = existingApp.appContact;
                let name = existingApp.appName;
                const denialReason = updateData.denialReason || updatedDoc.denialReason || "Not specified";

                if (phone && typeof phone === "string") {
                  phone = decrypt(phone);
                }

                if (name && typeof name === "string") {
                  name = decrypt(name);
                }

                console.log("[DEBUG] Decrypted borrower phone:", phone);
                console.log("[DEBUG] Decrypted borrower name:", name);

                if (phone) {
                  const formattedPhone = formatPhoneNumber(phone);
                  const message = `Hello ${name}, your loan application ${applicationId} has been denied due to: ${denialReason}. You may reapply online, or contact our office for more details.`;

                  await sendSMS(formattedPhone, message, "Gethsemane");
                  console.log(`Loan denial SMS sent to ${formattedPhone}`);
                } else {
                  console.warn(`[SMS SKIPPED] No phone number found for borrower of application ${applicationId}`);
                }
              } catch (smsErr) {
                console.error(`[SMS ERROR] Failed to send denial SMS:`, smsErr.message);
              }
            }


            // Notification system between manager and loan officer
            function normalizeRole(role) {
              return String(role || "").trim().toLowerCase().replace(/[_-]+/g, " ");
            }

            const actorRole = normalizeRole(req.user?.role || "");
            const prevStatus = String(existingApp.status || "").trim().toLowerCase();
            const nextStatus = String(updatedDoc.status || updateData.status || "").trim().toLowerCase();
            const changed = nextStatus !== prevStatus;

            const roleToCollection = {
              manager: "loanOfficer_notifications",
              "loan officer": "manager_notifications",
            };

            const targetCollectionName = roleToCollection[actorRole];

            if (changed && targetCollectionName) {
              const actorName = req.user?.name || req.user?.username || "Unknown";

              const message =
                actorRole === "manager"
                  ? `${actorName} (Manager) has changed application ${applicationId} to "${nextStatus}"`
                  : `${actorName} (Loan Officer) has changed application ${applicationId} to "${nextStatus}"`;

              await db.collection(targetCollectionName).insertOne({
                applicationId,
                message,
                status: nextStatus,
                createdAt: new Date(),
                read: false,
                actorRole,
                actorName,
                previousStatus: prevStatus,
              });

              console.log("[NOTIFICATION DEBUG] Sent:", message);
            }
          } catch (asyncErr) {
            console.error("[ASYNC POST-UPDATE ERROR]", asyncErr);
          }
        })();

      } catch (error) {
        console.error("Error in PUT /loan-applications/:applicationId:", error);
        res.status(500).json({ error: "Failed to update loan application." });
      }
    });


    router.put("/:applicationId/schedule-interview", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
      const { applicationId } = req.params;
      const { interviewDate, interviewTime } = req.body;
    
      if (!interviewDate || !interviewTime) {
        return res.status(400).json({ error: "Date and time are required" });
      }
    
      try {
        const result = await loanApplications.updateOne(
          { applicationId },
          { $set: { interviewDate, interviewTime, status: "Pending" } }
        );
    
        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Application not found" });
        }

        const creatorName = req.user.name;
    
        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: creatorName,
          role: req.user.role,
          action: "SCHEDULE_INTERVIEW",
          description: `${creatorName} scheduled an interview for loan application ${applicationId} on ${interviewDate} at ${interviewTime}`,
        });
    
        res.json({ message: "Interview scheduled successfully" });
      } catch (error) {
        console.error("Error scheduling interview:", error);
        res.status(500).json({ error: "Failed to schedule interview" });
      }
    });

    router.put("/:applicationId/principal", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
      try {
        const { applicationId } = req.params;
        const { newPrincipal } = req.body;
    
        const existingApp = await loanApplications.findOne({ applicationId });
        if (!existingApp) return res.status(404).json({ error: "Loan not found" });
    
        let optionKey = "";
        if (existingApp.loanType?.includes("With Collateral")) optionKey = "withCollateral";
        else if (existingApp.loanType?.includes("Without Collateral")) optionKey = "withoutCollateral";
        else optionKey = "openTerm";
    
        const options = loanOptions[optionKey] || [];
        let selectedOption;
        if (optionKey === "openTerm") {
          selectedOption = options.find(opt => opt.amount >= newPrincipal) || options[options.length - 1];
        } else {
          selectedOption =
            options.find(opt => opt.amount === newPrincipal) ||
            options.slice().sort((a, b) => b.amount - a.amount).find(opt => opt.amount <= newPrincipal) ||
            options[0];
        }
    
        const months = selectedOption?.months || Number(existingApp.appLoanTerms) || 12;
        const interestRate = selectedOption?.interest || Number(existingApp.appInterestRate) || 0;
        const updatedFields = computeLoanFields(Number(newPrincipal), months, interestRate);
    
        await loanApplications.updateOne({ applicationId }, { $set: updatedFields });
        const updatedApp = await loanApplications.findOne({ applicationId });

        const creatorName = req.user.name;

        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: creatorName,
          role: req.user.role,
          action: "UPDATE_PRINCIPAL",
          description: `${creatorName} updated the principal for loan application ${applicationId} to ${newPrincipal}`,
        });
        
        res.json({ updatedApp });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update principal" });
      }
    });

  // Endorse Principal Change
  router.post("/:applicationId/endorse-principal", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { requestedPrincipal } = req.body;

      const existingApp = await loanApplications.findOne({ applicationId });
      if (!existingApp) return res.status(404).json({ error: "Loan not found" });

      // Add principal change request fields to loan_applications
      const updateData = {
        pendingPrincipalChange: true,
        requestedPrincipal: Number(requestedPrincipal),
        principalChangeRequestedAt: new Date(),
        principalChangeRequestedBy: req.user.userId,
        principalChangeRequestedByName: req.user.name,
      };

      await loanApplications.updateOne({ applicationId }, { $set: updateData });
      const updatedApp = await loanApplications.findOne({ applicationId });

      // Log activity
      const creatorName = req.user.name;
      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: creatorName,
        role: req.user.role,
        action: "ENDORSE_PRINCIPAL",
        description: `${creatorName} requested principal change from ₱${existingApp.appLoanAmount} to ₱${requestedPrincipal} for loan application ${applicationId}`,
      });

      res.status(201).json({
        message: "Principal change request submitted for approval",
        updatedApp,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to submit principal change request" });
    }
  });

  // Approve Principal Change (Borrower)
  router.post("/:applicationId/approve-principal-change", authenticateToken, async (req, res) => {
    try {
      const { applicationId } = req.params;

      const existingApp = await loanApplications.findOne({ applicationId });
      if (!existingApp) return res.status(404).json({ error: "Loan not found" });

      if (!existingApp.pendingPrincipalChange || !existingApp.requestedPrincipal) {
        return res.status(400).json({ error: "No pending principal change request" });
      }

      // Get loan type for calculations
      let optionKey = "";
      if (existingApp.loanType?.includes("With Collateral")) optionKey = "withCollateral";
      else if (existingApp.loanType?.includes("Without Collateral")) optionKey = "withoutCollateral";
      else optionKey = "openTerm";

      const options = loanOptions[optionKey] || [];
      const newPrincipal = existingApp.requestedPrincipal;
      
      let selectedOption;
      if (optionKey === "openTerm") {
        selectedOption = options.find(opt => opt.amount >= newPrincipal) || options[options.length - 1];
      } else {
        selectedOption =
          options.find(opt => opt.amount === newPrincipal) ||
          options.slice().sort((a, b) => b.amount - a.amount).find(opt => opt.amount <= newPrincipal) ||
          options[0];
      }

      const months = selectedOption?.months || Number(existingApp.appLoanTerms) || 12;
      const interestRate = selectedOption?.interest || Number(existingApp.appInterestRate) || 0;
      const updatedFields = computeLoanFields(Number(newPrincipal), months, interestRate);

      // Update with new principal and clear pending flag
      const updateData = {
        ...updatedFields,
        pendingPrincipalChange: false,
        requestedPrincipal: null,
        principalChangeRequestedAt: null,
        principalChangeRequestedBy: null,
        principalChangeRequestedByName: null,
        principalChangeApprovedAt: new Date(),
        principalChangeApprovedBy: req.user.userId,
      };

      await loanApplications.updateOne({ applicationId }, { $set: updateData });
      const updatedApp = await loanApplications.findOne({ applicationId });

      // Log activity
      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: req.user.name,
        role: req.user.role,
        action: "APPROVE_PRINCIPAL_CHANGE",
        description: `${req.user.name} approved principal change to ₱${newPrincipal} for loan application ${applicationId}`,
      });

      res.status(200).json({
        message: "Principal change approved successfully",
        updatedApp,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to approve principal change" });
    }
  });

  // Reject Principal Change (Borrower)
  router.post("/:applicationId/reject-principal-change", authenticateToken, async (req, res) => {
    try {
      const { applicationId } = req.params;

      const existingApp = await loanApplications.findOne({ applicationId });
      if (!existingApp) return res.status(404).json({ error: "Loan not found" });

      if (!existingApp.pendingPrincipalChange || !existingApp.requestedPrincipal) {
        return res.status(400).json({ error: "No pending principal change request" });
      }

      // Clear pending flag without applying changes
      const updateData = {
        pendingPrincipalChange: false,
        requestedPrincipal: null,
        principalChangeRequestedAt: null,
        principalChangeRequestedBy: null,
        principalChangeRequestedByName: null,
        principalChangeRejectedAt: new Date(),
        principalChangeRejectedBy: req.user.userId,
      };

      await loanApplications.updateOne({ applicationId }, { $set: updateData });
      const updatedApp = await loanApplications.findOne({ applicationId });

      // Log activity
      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: req.user.name,
        role: req.user.role,
        action: "REJECT_PRINCIPAL_CHANGE",
        description: `${req.user.name} rejected principal change request for loan application ${applicationId}`,
      });

      res.status(200).json({
        message: "Principal change rejected",
        updatedApp,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to reject principal change" });
    }
  });

  // Save Service Fee & Net Released before printing
  router.put("/:applicationId/release", authenticateToken, authorizeRole("manager", "loan officer"), async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { serviceFee, netReleased } = req.body;

      if (serviceFee == null || netReleased == null) {
        return res.status(400).json({ error: "serviceFee and netReleased are required" });
      }

      const existingApp = await loanApplications.findOne({ applicationId });
      if (!existingApp) return res.status(404).json({ error: "Loan application not found." });

      await loanApplications.updateOne(
        { applicationId },
        { $set: { appServiceFee: Number(serviceFee), appNetReleased: Number(netReleased), hasServiceFee: "true" } }
      );

      const updatedApp = await loanApplications.findOne({ applicationId });

      const creatorName = req.user.name;

      // Log activity
      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: creatorName,
        role: req.user.role,
        action: "UPDATE_RELEASE",
        description: `${creatorName} updated service fee (${serviceFee}) and net released (${netReleased}) for loan application ${applicationId}`,
      });

      res.status(200).json({ message: "Release data saved successfully", updatedApp });
    } catch (err) {
      console.error("Error in PUT /loan-applications/:applicationId/release:", err);
      res.status(500).json({ error: "Failed to save release data" });
    }
  });

    return router;
  };
