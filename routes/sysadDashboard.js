const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/auth");
const authorizeRole = require("../middleware/authorizeRole");
const { decrypt } = require('../utils/crypt'); 

module.exports = (db) => {
  const users = db.collection("users");
  const borrowers = db.collection("borrowers_account"); 
  const logs = db.collection("activity_logs");

  router.get(
    "/all",
    authenticateToken,
    authorizeRole("sysad"),
    async (req, res) => {
      try {
        const allLogs = await logs.find({}).sort({ createdAt: -1 }).toArray();
        res.json(allLogs);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch logs." });
      }
    }
  );  

  router.get(
    "/overview",
    authenticateToken,
    authorizeRole("sysad"),
    async (req, res) => {
      try {
        const activeStaffRaw = await users
          .find(
            { status: "Active" },
            { projection: { password: 0 } }
          )
          .toArray();

        // Decrypt email and phoneNumber before returning
        const activeStaff = activeStaffRaw.map(u => ({
          ...u,
          email: u.email ? decrypt(u.email) : null,
          phoneNumber: u.phoneNumber ? decrypt(u.phoneNumber) : null,
        }));

        const activeBorrowers = await borrowers
          .find({}, { projection: { password: 0 } })
          .toArray();

        const recentLogs = await logs
          .find({})
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray();

        res.json({
          totals: {
            users: activeStaff.length + activeBorrowers.length,
            borrowers: activeBorrowers.length, 
          },
          activeStaff,
          recentLogs,
        });
      } catch (error) {
        console.error("Error fetching sysad overview:", error);
        res.status(500).json({ error: "Failed to fetch sysad overview." });
      }
    }
  );

  return router;
};
