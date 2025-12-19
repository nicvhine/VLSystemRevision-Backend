const express = require("express");
const router = express.Router();
const { upload, validate2x2, processUploadedDocs } = require("../../utils/uploadConfig");
const { createLoanApplication } = require("../../services/loanApplicationService");
const { createReloanApplication } = require("../../services/reloanApplicationService");
const loanApplicationRepository = require("../../repositories/loanApplicationRepository");
const logRepository = require("../../repositories/logRepository"); 
const { encrypt, decrypt } = require("../../utils/crypt");

// Submit a new loan application with file uploads
module.exports = (db) => {
  const repo = loanApplicationRepository(db);
  const logRepo = logRepository(db);

  router.post(
    "/apply/:loanType",
    upload.fields([
      { name: "documents", maxCount: 6 },
      { name: "profilePic", maxCount: 1 }
    ]),
    validate2x2,
    async (req, res) => {
      try {
        const { loanType } = req.params;
        const uploadedFiles = await processUploadedDocs(req.files);
  
        const application = await createLoanApplication(req, loanType, repo, db, uploadedFiles);
  
         // Log the action
        await logRepo.insertActivityLog({
          action: "CREATE_LOAN_APPLICATION",
          description: `New ${loanType} loan application submitted.`,
        });

        res.status(201).json({
          message: "Loan application submitted successfully.",
          application,
        });
      } catch (error) {
        console.error("Error in /loan-applications/apply/:loanType:", error);
        res.status(400).json({ error: error.message || "Failed to submit loan application." });
      }
    }
  );
  
  // Re-loan application 
  router.post(
    "/reloan/:loanType",
    upload.fields([
      { name: "documents", maxCount: 6 },
      { name: "profilePic", maxCount: 1 }
    ]),
    validate2x2,
    async (req, res) => {
      try {
        const { loanType } = req.params;
        const uploadedFiles = await processUploadedDocs(req.files);

        // Force reloan flags
        req.body.isReloan = true;

        const application = await createReloanApplication(req, loanType, repo, db, uploadedFiles);

        await logRepo.insertActivityLog({
          action: "CREATE_LOAN_APPLICATION",
          description: `New ${loanType} loan application submitted.`,
        });

        res.status(201).json({
          message: "Re-loan application submitted successfully.",
          application,
        });
      } catch (error) {
        console.error("Error in /loan-applications/reloan/:loanType:", error);
        res.status(400).json({ error: error.message || "Failed to submit re-loan application." });
      }
    }
  );

// Check for duplicate loan applications
router.post("/check-duplicate", async (req, res) => {
  try {
    const { appName, appDob, appEmail } = req.body;

    // Fetch all applications
    const applications = await db.collection("loan_applications").find({}).toArray();

    // Find a match by decrypting stored data
    const match = applications.find(app => {
      try {
        const decryptedName = decrypt(app.appName);
        const decryptedEmail = decrypt(app.appEmail);

        return (
          decryptedName.toLowerCase().trim() === appName.toLowerCase().trim() &&
          decryptedEmail.toLowerCase().trim() === appEmail.toLowerCase().trim() &&
          app.appDob === appDob
        );
      } catch (err) {
        console.error("Decryption error:", err);
        return false;
      }
    });

    if (match) {
      return res.json({
        isDuplicate: true,
        status: match.status,
      });
    }

    res.json({ isDuplicate: false });
  } catch (error) {
    console.error("Check duplicate error:", error);
    res.status(500).json({ error: "Server error." });
  }
});

// Check for contact/email conflicts (same contact/email, different name)
router.post("/check-contact-conflict", async (req, res) => {
  try {
    const { appName, appContact, appEmail } = req.body;

    const applications = await db
      .collection("loan_applications")
      .find({})
      .toArray();

    for (const app of applications) {
      try {
        const decryptedName = decrypt(app.appName);
        const decryptedContact = decrypt(app.appContact);
        const decryptedEmail = decrypt(app.appEmail);

        const nameDifferent =
          decryptedName.toLowerCase().trim() !== appName.toLowerCase().trim();

        if (!nameDifferent) continue;

        // Diff name, same number
        if (decryptedContact === appContact) {
          return res.json({
            hasConflict: true,
            message: "Entered number is already used.",
            field: "contact"
          });
        }

        // Diff name, same email
        if (
          decryptedEmail.toLowerCase().trim() ===
          appEmail.toLowerCase().trim()
        ) {
          return res.json({
            hasConflict: true,
            message: "Entered email is already used.",
            field: "email"
          });
        }
      } catch (err) {
        console.error("Decryption error:", err);
      }
    }

    return res.json({ hasConflict: false });
  } catch (error) {
    console.error("Check contact conflict error:", error);
    res.status(500).json({ error: "Server error." });
  }
});


  return router;
};
