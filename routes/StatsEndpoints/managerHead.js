const express = require('express');
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const { decrypt } = require('../../utils/crypt');

module.exports = (db) => {
  const borrowers = db.collection('borrowers_account');
  const loans = db.collection('loan_applications');
  const loanPayments = db.collection('loans'); 
  const collections = db.collection('collections');
  const agentsCollection = db.collection('agents');

  const router = express.Router();

  router.get(
    "/dashboard-stats",
    authenticateToken,
    authorizeRole("manager", "head", "loan officer"),
    async (req, res) => {
      try {
        // -----------------------------
        // Borrower stats
        // -----------------------------
        const totalBorrowers = await borrowers.countDocuments({});
        const activeBorrowersAgg = await loanPayments.aggregate([
          { $match: { status: "Active" } },
          { $group: { _id: "$borrowersId" } },
          { $count: "activeBorrowers" }
        ]).toArray();
        const activeBorrowers = activeBorrowersAgg[0]?.activeBorrowers || 0;

        // -----------------------------
        // Loan / collection aggregates
        // -----------------------------
        const [
          totalDisbursedResult,
          totalCollectedResult,
          collectablesResult,
          totalLoans,
          closedLoans,
          totalApplications,
          pendingApplicationsResult,
          approvedApplicationsResult,
          deniedApplicationsResult
        ] = await Promise.all([
          loans.aggregate([
            { $match: { status: { $in: ["Active", "Closed"] } } },
            { $group: { _id: null, total: { $sum: { $toDouble: "$appLoanAmount" } } } }
          ]).toArray(),
          collections.aggregate([
            { $group: { _id: null, total: { $sum: { $toDouble: "$paidAmount" } } } }
          ]).toArray(),
          loans.aggregate([
            { $match: { status: "Active" } },
            { $group: { _id: null, total: { $sum: { $toDouble: "$appTotalPayable" } } } }
          ]).toArray(),
          loanPayments.countDocuments({}),
          loans.countDocuments({ status: "Closed" }),
          loans.countDocuments({}),
          loans.countDocuments({ status: { $in: ["Applied", "Pending", "Cleared", "Approved"] } }),
          loans.countDocuments({ status: { $in: ["Disbursed", "Active", "Closed"] } }),
          loans.countDocuments({ status: { $in: ["Denied by LO", "Denied"] } })
        ]);

        // -----------------------------
        // Borrowers over time
        // -----------------------------
        const borrowersOverTime = await loanPayments.aggregate([
          { $match: { status: { $in: ["Active", "Closed"] } } },
          {
            $group: {
              _id: { month: { $month: "$dateDisbursed" }, year: { $year: "$dateDisbursed" } },
              newBorrowers: { $addToSet: "$borrowersId" },
              activeBorrowers: { $addToSet: { $cond: [{ $eq: ["$status", "Active"] }, "$borrowersId", "$$REMOVE"] } }
            }
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          {
            $project: {
              month: { $concat: [{ $toString: "$_id.month" }, "-", { $toString: "$_id.year" }] },
              new: { $size: "$newBorrowers" },
              active: { $size: "$activeBorrowers" },
              _id: 0
            }
          }
        ]).toArray();

        // -----------------------------
        // Loan disbursement over time
        // -----------------------------
        const loanDisbursementOverTime = await loans.aggregate([
          { $match: { status: { $in: ["Active", "Closed"] } } },
          {
            $group: {
              _id: { month: { $month: "$dateDisbursed" }, year: { $year: "$dateDisbursed" } },
              totalDisbursed: { $sum: { $toDouble: "$appLoanAmount" } }
            }
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          {
            $project: {
              month: { $concat: [{ $toString: "$_id.month" }, "-", { $toString: "$_id.year" }] },
              disbursed: "$totalDisbursed",
              _id: 0
            }
          }
        ]).toArray();

        // -----------------------------
        // Applications by type
        // -----------------------------
        const applicationsByType = await loans.aggregate([
          { $group: { _id: "$loanType", count: { $sum: 1 } } },
          { $project: { type: "$_id", count: 1, _id: 0 } }
        ]).toArray();

        // -----------------------------
        // Top borrowers
        // -----------------------------
        const topBorrowersRaw = await loanPayments.aggregate([
          { $match: { status: { $in: ["Active", "Closed"] } } },
          {
            $lookup: {
              from: "loan_applications",
              localField: "borrowersId",
              foreignField: "borrowersId",
              as: "loanDetails"
            }
          },
          { $unwind: "$loanDetails" },
          {
            $addFields: {
              loanAmountForPercentage: {
                $cond: [
                  { $eq: ["$loanDetails.loanType", "Open-Term Loan"] },
                  { $toDouble: "$loanDetails.appLoanAmount" },
                  { $toDouble: "$loanDetails.appTotalPayable" }
                ]
              },
              paidForPercentage: {
                $cond: [
                  { $eq: ["$loanDetails.loanType", "Open-Term Loan"] },
                  { $subtract: [{ $toDouble: "$loanDetails.appLoanAmount" }, { $toDouble: "$balance" }] },
                  { $toDouble: "$paidAmount" }
                ]
              }
            }
          },
          {
            $group: {
              _id: "$borrowersId",
              totalLoanForPercentage: { $sum: "$loanAmountForPercentage" },
              totalPaidForPercentage: { $sum: "$paidForPercentage" },
              totalPaid: { $sum: "$paidAmount" },
              totalBalance: { $sum: "$balance" }
            }
          },
          {
            $lookup: {
              from: "borrowers_account",
              localField: "_id",
              foreignField: "borrowersId",
              as: "borrower"
            }
          },
          { $unwind: "$borrower" },
          {
            $addFields: {
              percentagePaid: {
                $cond: [
                  { $eq: ["$totalLoanForPercentage", 0] },
                  0,
                  { $multiply: [{ $divide: ["$totalPaidForPercentage", "$totalLoanForPercentage"] }, 100] }
                ]
              }
            }
          },
          { $sort: { percentagePaid: -1 } },
          { $limit: 5 }
        ]).toArray();

        const topBorrowers = topBorrowersRaw.map(b => ({
          borrowerName: decrypt(b.borrower.name),
          totalPaid: b.totalPaid,
          totalBalance: b.totalBalance,
          totalLoan: b.totalLoanForPercentage,
          percentagePaid: b.percentagePaid
        }));                

        // -----------------------------
        // Top collectors (updated)
        // -----------------------------
        const collectors = await db.collection("users").find({ role: "collector" }).toArray();
        const topCollectors = await Promise.all(
          collectors.map(async (c) => {
            const collectionsForCollector = await collections.find({ collectorId: c.userId }).toArray();
            const totalAssigned = collectionsForCollector.length; // total collections assigned
            const paidCollections = collectionsForCollector.filter(col => col.status === "Paid").length; // only paid
            return { collectorId: c.userId, name: c.name, totalAssigned, paidCollections };
          })
        );

        topCollectors.sort((a, b) => (b.paidCollections / b.totalAssigned) - (a.paidCollections / a.totalAssigned));
        
        // -----------------------------
        // Top agents
        // -----------------------------
        const agents = await agentsCollection.find({}).toArray();
        const topAgents = agents
          .map(a => ({ agentId: a._id.toString(), name: a.name, totalProcessedLoans: a.totalLoanAmount || 0 }))
          .sort((a, b) => b.totalProcessedLoans - a.totalProcessedLoans)
          .slice(0, 5);

        // -----------------------------
        // Response
        // -----------------------------
        res.json({
          totalBorrowers,
          activeBorrowers,
          totalDisbursed: totalDisbursedResult[0]?.total || 0,
          totalCollected: totalCollectedResult[0]?.total || 0,
          collectables: collectablesResult[0]?.total || 0,
          totalLoans,
          closedLoans,
          totalApplications,
          pendingApplications: pendingApplicationsResult,
          approvedApplications: approvedApplicationsResult,
          deniedApplications: deniedApplicationsResult,
          borrowersOverTime,
          loanDisbursementOverTime,
          applicationsByType,
          topBorrowers,
          topCollectors: topCollectors.slice(0,5),
          topAgents
        });

      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    }
  );

  return router;
};
