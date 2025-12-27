const express = require("express");
const router = express.Router();
const { createLoan, createOpenTermLoan } = require("../../services/loanService");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const loanRepository = require("../../repositories/loanRepository");

module.exports = (db) => {
  router.post("/generate-loan/:applicationId", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    const { applicationId } = req.params;
    const repo = loanRepository(db);

    try {
      // Fetch application to check loan type
      const application = await repo.findApplicationById(applicationId);
      if (!application) return res.status(404).json({ error: "Application not found" });

      let loan;
      if (application.loanType === "Open-Term Loan") {
        loan = await createOpenTermLoan(applicationId, db);
      } else {
        loan = await createLoan(applicationId, db); 
      }

      res.status(201).json({ message: "Loan and collections created successfully", loan });
    } catch (error) {
      console.error("Error generating loan:", error);
      res.status(400).json({ error: error.message });
    }
  });

  return router;
};
