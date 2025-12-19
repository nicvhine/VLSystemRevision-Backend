const express = require('express');
const router = express.Router();
const { decrypt } = require("../../utils/crypt");
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
module.exports = (db) => {
  const loans = db.collection('loans');


  router.get("/application-statuses",
  authenticateToken,
  authorizeRole("manager", "head", "loan officer"),
  async (req, res) => {
    try {
      const statuses = await db.collection("loan_applications").aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      const statusMap = {
        applied: ["Applied", "Cleared", "Pending"],
        approved: ["Approved", "Disbursed", "Active"],
        denied: ["Denied by LO", "Denied"],
      };

      const sum = (list) => statuses
        .filter(s => list.includes(s._id))
        .reduce((a, b) => a + b.count, 0);

      res.json({
        applied: sum(statusMap.applied),
        approved: sum(statusMap.approved),
        denied: sum(statusMap.denied),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch application status stats" });
    }
  }
);

  router.get("/applied-loan-type-stats", authenticateToken, authorizeRole("manager", "head", "loan officer"), async (req, res) => {
    try {
      const collection = db.collection("loan_applications");
  
      const types = await collection.aggregate([
        {
          $group: {
            _id: "$loanType",
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            loanType: "$_id",
            count: 1
          }
        }
      ]).toArray();
  
      res.status(200).json(types);
    } catch (error) {
      console.error("Error fetching loan type stats:", error);
      res.status(500).json({ error: "Failed to fetch loan type statistics" });
    }
  });  

// Top Agents
router.get("/top-agents", async (req, res) => {
  try {
    // Get all agents as an array
    const agents = await db.collection("agents").find({}).toArray();

    // Map to include only relevant fields
    const agentStats = agents.map(a => ({
      agentId: a._id.toString(),
      name: a.name,
      totalProcessedLoans: a.totalLoanAmount,
    }));

    // Sort by totalLoanAmount descending and take top 5
    agentStats.sort((a, b) => b.totalProcessedLoans - a.totalProcessedLoans);
    const topAgents = agentStats.slice(0, 5);

    res.json(topAgents);
  } catch (err) {
    console.error("Error fetching top agents:", err);
    res.status(500).json({ message: "Failed to fetch top agents" });
  }
});



  return router;
};
