const express = require("express");
const router = express.Router();
const ClosureService = require("../../services/closureService");

module.exports = (db) => {
  const service = ClosureService(db);

  // get all closures
  router.get("/", async (req, res) => {
    try {
      const closures = await service.getAllClosure();
      res.json({ data: closures });
    } catch (err) {
      console.error("Error fetching closures:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // get closure by endorsement ID
  router.get("/:id", async (req, res) => {
    try {
      const closure = await service.getClosureById(req.params.id);
      res.json({ data: closure });
    } catch (err) {
      console.error("Error fetching closure by ID:", err);
      res.status(404).json({ message: err.message });
    }
  });

  router.get("/by-loan/:loanId", async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const closure = await service.getClosureByLoanId(loanId);
  
      if (!closure) {
        return res.json({ hasClosure: false });
      }
  
      res.json({
        hasClosure: true,
        status: closure.status,
        createdAt: closure.createdAt
      });
    } catch (err) {
      console.error("Error checking closure by loanId:", err);
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};
