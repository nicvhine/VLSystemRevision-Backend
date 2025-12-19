const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const { decrypt } = require('../../utils/crypt');

module.exports = (db) => {

// Get all loans (staff only)
  router.get(
    "/",
    authenticateToken,
    authorizeRole("manager", "head", "loan officer", "collector"),
    async (req, res) => {
      try {
        let query = {};

        // If collector, only fetch loans for borrowers assigned to them
        if (req.user.role === "collector") {
          // Get borrowers assigned to this collector
          const assignedBorrowers = await db
            .collection("borrowers_account")
            .find({ assignedCollectorId: req.user.userId })
            .project({ borrowersId: 1 })
            .toArray();

          const borrowerIds = assignedBorrowers.map((b) => b.borrowersId);

          // Fetch loans for those borrowers (include all statuses)
          query = { borrowersId: { $in: borrowerIds } };
        } else {
          // For other roles, fetch all loans (include all statuses)
          query = {};
        }

        const loans = await db.collection("loans").find(query).toArray();

        const loansWithDetails = await Promise.all(
          loans.map(async (loan) => {
            const borrower = await db
              .collection("borrowers_account")
              .findOne({ borrowersId: loan.borrowersId });
            const application = await db
              .collection("loan_applications")
              .findOne({ applicationId: loan.applicationId });

            return {
              ...loan,
              ...application,
              name: borrower ? decrypt(borrower.name) : "",
            };
          })
        );

        res.status(200).json(loansWithDetails);
      } catch (error) {
        console.error("Error in GET /loans:", error);
        res.status(500).json({ error: "Failed to fetch loans." });
      }
    }
  );

  // Get single loan by loanId
  router.get(
    "/:loanId",
    authenticateToken,
    authorizeRole("manager", "head", "loan officer", "borrower"),
    async (req, res) => {
      const { loanId } = req.params;
      const { role, borrowersId: jwtBorrowersId } = req.user;

      try {
        const loan = await db.collection("loans").findOne({ loanId });
        if (!loan) return res.status(404).json({ error: "Loan not found." });

        // Borrower can only fetch their own loan
        if (role === "borrower" && loan.borrowersId !== jwtBorrowersId) {
          return res.status(403).json({ error: "You are not authorized to view this loan." });
        }

        const application = await db.collection("loan_applications").findOne({ applicationId: loan.applicationId });
        if (!application) return res.status(404).json({ error: "Loan application not found." });

        const isActive = loan.status === "Active";
        const pastLoans = await db.collection("loans")
          .find({ borrowersId: loan.borrowersId, status: { $ne: "Active" } })
          .sort({ dateDisbursed: -1 })
          .toArray();

        const totalLoansCount = await db.collection("loans").countDocuments({ borrowersId: loan.borrowersId });

        const d = (val) => val ? decrypt(val) : "";
        const parsedReferences = Array.isArray(application.appReferences) ? application.appReferences : [];

        const currentLoan = isActive ? {
          principal: application.appLoanAmount,
          totalPayable: application.appTotalPayable,
          type: application.loanType,
          termsInMonths: application.appLoanTerms,
          interestRate: application.appInterestRate,
          paymentSchedule: loan.paymentSchedule,
          startDate: loan.dateReleased?.toISOString().split("T")[0],
          paidAmount: loan.paidAmount || 0,
          remainingBalance: loan.balance || application.appTotalPayable,
          dateDisbursed: loan.dateDisbursed,
          status: loan.status,
        } : undefined;

        const response = {
          ...loan,
          ...application,
          name: d(application.appName),
          spouseName: d(application.appSpouseName),
          contactNumber: d(application.appContact),
          emailAddress: d(application.appEmail),
          address: d(application.appAddress),
          references: parsedReferences.map(r => ({
            name: d(r.name),
            contact: d(r.contact),
            relation: r.relation,
          })),
          totalLoans: totalLoansCount,
          currentLoan,
          previousLoans: pastLoans.map(l => ({
            type: l.loanType,
            principal: l.principal,
            amount: l.principal,
            dateDisbursed: l.dateDisbursed,
            status: l.status,
            interestRate: l.interestRate,
            terms: l.termsInMonths,
          })),
        };

        res.json(response);

      } catch (error) {
        console.error("Error fetching loan by loanId:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get full loan details with collections
  router.get(
    "/details/:loanId",
    authenticateToken,
    authorizeRole("manager", "head", "loan officer", "borrower"),
    async (req, res) => {
      const { loanId } = req.params;
      const { role, borrowersId: jwtBorrowersId } = req.user;

      try {
        const loan = await db.collection("loans").findOne({ loanId });
        if (!loan) return res.status(404).json({ error: "Loan not found." });

        if (role === "borrower" && loan.borrowersId !== jwtBorrowersId) {
          return res.status(403).json({ error: "You are not authorized to view this loan." });
        }

        const application = await db.collection("loan_applications").findOne({ applicationId: loan.applicationId });
        const collections = await db.collection("collections").find({ loanId }).sort({ collectionNumber: 1 }).toArray();

        const result = {
          loanId: loan.loanId,
          ...application,
          collections,
          borrowerDetails: {
            address: application?.appAddress,
            contact: application?.appContact,
            occupation: application?.appOccupation,
            incomeSource: application?.sourceOfIncome,
            monthlyIncome: application?.appMonthlyIncome,
          },
        };

        res.json(result);

      } catch (error) {
        console.error("Error fetching loan details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get all loans for a borrower
  router.get(
    "/all/:borrowersId",
    authenticateToken,
    authorizeRole("manager", "head", "loan officer", "borrower"),
    async (req, res) => {
      const { borrowersId } = req.params;
      const { role, borrowersId: jwtBorrowersId } = req.user;

      if (role === "borrower" && borrowersId !== jwtBorrowersId) {
        return res.status(403).json({ error: "You are not authorized to view these loans." });
      }

      try {
        const loans = await db.collection("loans").find({ borrowersId }).toArray();

        const loansWithDetails = await Promise.all(
          loans.map(async (loan) => {
            const borrower = await db.collection("borrowers_account").findOne({ borrowersId: loan.borrowersId });
            const application = await db.collection("loan_applications").findOne({ applicationId: loan.applicationId });

            return {
              ...loan,
              ...application,
              name: borrower ? decrypt(borrower.name) : "",
            };
          })
        );

        res.status(200).json(loansWithDetails);

      } catch (error) {
        console.error("Error fetching loans for borrower:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  return router;
};