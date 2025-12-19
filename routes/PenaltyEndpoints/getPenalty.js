const express = require("express");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const penaltyEndorsementRepository = require("../../repositories/penaltyRespository");
const penaltyEndorsementServiceFactory = require("../../services/penaltyService");
const { decrypt } = require("../../utils/crypt");

const router = express.Router();

module.exports = (db) => {
  const repo = penaltyEndorsementRepository(db);
  const service = penaltyEndorsementServiceFactory(repo, db);

  router.get("/", authenticateToken, authorizeRole("loan officer", "head"), async (req, res) => {
    try {
      const endorsements = await service.getAllEndorsements();
  
      const decryptedEndorsements = endorsements.map(e => ({
        ...e,
        borrowerName: e.borrowerName ? decrypt(e.borrowerName) : null
      }));
  
      res.json(decryptedEndorsements);
    } catch (error) {
      console.error("Error fetching penalty endorsements:", error);
      res.status(500).json({ message: "Server error fetching endorsements" });
    }
  });
  
  return router;
};
