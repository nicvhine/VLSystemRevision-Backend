const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const LoanRepository = require("../../repositories/loanRepository");

module.exports = (db) => {
  const repo = LoanRepository(db);

  router.put(
    "/reloan/:applicationId",
    authenticateToken,
    authorizeRole("manager"),
    async (req, res) => {
      const { applicationId } = req.params;

      try {
        // 1. Fetch the loan application to get borrowersId
        const application = await db
          .collection("loan_applications")
          .findOne({ applicationId });
        if (!application)
          return res.status(404).json({ error: "Application not found" });

        const borrowersId = application.borrowersId;
        if (!borrowersId)
          return res
            .status(400)
            .json({ error: "Borrower not linked to this application" });

        // 2. Fetch all active loans of this borrower
        const activeLoans = await repo.findActiveLoansByBorrowerId(borrowersId);

        // 3. Exclude current application loan if exists
        const loansToDeactivate = activeLoans.filter(
          (loan) => loan.applicationId !== applicationId
        );

        console.log("Loans to deactivate:", loansToDeactivate);

        // 4. Deactivate old loans AND update their loan applications
        for (const loan of loansToDeactivate) {
          // Deactivate loan
          await repo.updateLoanStatus(loan.loanId, "Closed");

          // Also mark their loan application as Inactive
          await db.collection("loan_applications").updateOne(
            { applicationId: loan.applicationId },
            { $set: { status: "Closed" } }
          );

          // Fetch collections under this loan
          const collections = await repo.findCollectionsByLoan(loan.loanId);
          for (const col of collections) {
            // Mark Unpaid or Partial as Paid
            if (col.status === "Unpaid" || col.status === "Partial") {
              await repo.updateCollectionStatus(col.referenceNumber, "Paid");
            }
          }
        }

        // 5. Update current application status to "Disbursed"
        await db.collection("loan_applications").updateOne(
          { applicationId },
          { $set: { status: "Active" } }
        );

        res.json({
          message:
            "Previous loans and applications deactivated, unpaid collections marked as Paid, current application set to Disbursed",
        });
      } catch (error) {
        console.error(error);
        res.status(400).json({ error: error.message });
      }
    }
  );

  return router;
};
