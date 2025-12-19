const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const { createAgent } = require("../../services/agentService");
const agentRepository = require("../../repositories/agentRepository");
const logRepository = require("../../repositories/logRepository"); 

// Create a new agent (loan officer only)
module.exports = (db) => {
  const repo = agentRepository(db);
  const logRepo = logRepository(db); 

  router.post("/", authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    try {
      const newAgent = await createAgent(req.body, repo, db);

      const creatorName = req.user?.name || "Unknown";

      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: req.user.name,
        role: req.user.role,
        action: "CREATE_AGENT",
        description: `${creatorName} added a new agent: ${newAgent.name}`,
      });
      
      res.status(201).json({ message: "Agent added successfully", agent: newAgent });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  return router;
};
