const express = require("express");
const paymentService = require("../../services/paymentService");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");

module.exports = (db) => {
  const router = express.Router();
  
  router.get(
    "/ledger/:loanId",
    authenticateToken,
    authorizeRole("manager", "loan officer", "borrower", "head", "collector"),
    async (req, res) => {
      try {
        const { role, borrowersId: jwtBorrowersId, userId, username } = req.user;
        const loanId = req.params.loanId;

        // Fetch full ledger
        const ledger = await paymentService.getLoanLedger(loanId, db);

        if (!ledger || ledger.length === 0) {
          return res.status(404).json({ success: false, message: "No payments found" });
        }

        // Restrict access
        if (role === "borrower") {
          // Borrower can only see their own ledger
          if (!ledger.every(p => p.borrowersId === jwtBorrowersId)) {
            return res.status(403).json({ success: false, message: "Access denied" });
          }
        } else if (role === "collector") {
          // Collector can only see payments for assigned borrowers
          const assignedBorrowers = await db
            .collection("borrowers_account")
            .find({ assignedCollectorId: userId })
            .project({ borrowersId: 1 })
            .toArray();
          const borrowerIds = assignedBorrowers.map(b => b.borrowersId);

          if (!ledger.every(p => borrowerIds.includes(p.borrowersId))) {
            return res.status(403).json({ success: false, message: "Access denied" });
          }
        }

        res.json({ success: true, payments: ledger });
      } catch (err) {
        console.error("Ledger error:", err);
        res.status(500).json({ success: false, message: err.message });
      }
    }
  );


  router.get(
    "/borrower/:borrowersId",
    authenticateToken,
    authorizeRole("manager", "loan officer", "head", "borrower"),
    async (req, res) => {
      try {
        const { role, borrowersId: jwtBorrowersId } = req.user;
        const borrowersId = req.params.borrowersId;
  
        // Borrower can only fetch their own payments
        if (role === "borrower" && borrowersId !== jwtBorrowersId) {
          return res.status(403).json({ error: "Access denied" });
        }
  
        const payments = await paymentService.getBorrowerPayments(borrowersId, db);
        res.json(payments);
      } catch (err) {
        console.error("Borrower payments error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.get(
    "/collection-balance/:referenceNumber",
    authenticateToken,
    authorizeRole("manager", "loan officer", "borrower", "head", "collector"),
    async (req, res) => {
      try {
        const { role, borrowersId: jwtBorrowersId, userId } = req.user;
        let { referenceNumber } = req.params;
  
        // Strip -P- suffix if present
        if (referenceNumber.includes("-P-")) {
          referenceNumber = referenceNumber.split("-P-")[0];
        }
  
        // Fetch the collection
        const collection = await db.collection("collections").findOne({ referenceNumber });
        if (!collection) {
          return res.status(404).json({ success: false, message: "Collection not found" });
        }
  
        // Role-based access check
        if (role === "borrower" && collection.borrowersId !== jwtBorrowersId) {
          return res.status(403).json({ success: false, message: "Access denied" });
        } else if (role === "collector") {
          const assignedBorrowers = await db
            .collection("borrowers_account")
            .find({ assignedCollectorId: userId })
            .project({ borrowersId: 1 })
            .toArray();
          const borrowerIds = assignedBorrowers.map(b => b.borrowersId);
  
          if (!borrowerIds.includes(collection.borrowersId)) {
            return res.status(403).json({ success: false, message: "Access denied" });
          }
        }
  
        // runningBalance is already stored in the collection
        const runningBalance = collection.runningBalance ?? 0;
        const periodInterestAmount = collection.periodInterestAmount ?? 0;
  
        res.json({ success: true, referenceNumber, runningBalance, periodInterestAmount });
      } catch (err) {
        console.error("Collection balance error:", err);
        res.status(500).json({ success: false, message: err.message });
      }
    }
  );
  
  

  router.get(
    "/paymongo",
    authenticateToken,
    authorizeRole("collector"),
    async (req, res) => {
      try {
        const { userId } = req.user;

        // Get borrowers assigned to this collector
        const assignedBorrowers = await db
          .collection("borrowers_account")
          .find({ assignedCollectorId: userId })
          .project({ borrowersId: 1 })
          .toArray();

        const borrowerIds = assignedBorrowers.map(b => b.borrowersId);

        if (borrowerIds.length === 0) {
          return res.status(404).json({ success: false, message: "No borrowers assigned to you" });
        }

        // Get Paymongo payments with borrower names
        const payments = await paymentService.getPaymongoPaymentsWithNames(borrowerIds, db);

        if (!payments.length) {
          return res.status(404).json({ success: false, message: "No Paymongo payments found" });
        }

        res.json({ success: true, payments });
      } catch (err) {
        console.error("Paymongo payments error:", err);
        res.status(500).json({ success: false, message: err.message });
      }
    }
  );

  
  return router;
};
