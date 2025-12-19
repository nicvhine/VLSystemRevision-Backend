const express = require('express');
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const AgentRepo = require('../../repositories/agentRepository');

module.exports = (db) => {
  const router = express.Router();
  const agentRepo = AgentRepo(db); 

  router.put('/:agentId', authenticateToken, authorizeRole("loan officer"), async (req, res) => {
    try {
      const { agentId } = req.params;
      const { name, phoneNumber, status } = req.body;

      const agent = await agentRepo.getAgentById(agentId);
      if (!agent) return res.status(404).json({ message: 'Agent not found' });

      const updatedFields = {};
      if (name) updatedFields.name = name.trim();
      if (phoneNumber) updatedFields.phoneNumber = phoneNumber.trim();
      if (status && (status === "Active" || status === "Inactive")) updatedFields.status = status;

      await agentRepo.updateAgentStats(agentId, updatedFields);

      res.json({ success: true, agent: { ...agent, ...updatedFields } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  });

  return router;
};
