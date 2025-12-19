const express = require("express");
const router = express.Router();
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const loanAppRepository = require("../../repositories/loanApplicationRepository");
const loanAppService = require("../../services/loanApplicationService");

module.exports = (db) => {
  const repo = loanAppRepository(db);

  // GET all applications
  router.get("/", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const apps = await loanAppService.getAllApplications(repo);
      res.status(200).json(apps);
    } catch (error) {
      console.error("Error in GET /loan-applications:", error);
      res.status(500).json({ error: "Failed to fetch loan applications." });
    }
  });

  router.get("/active", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const allApps = await loanAppService.getAllApplications(repo);
      const activeApps = allApps.filter(
        app => app.status !== "Denied" && app.status !== "Denied by LO"
      );
      
      res.status(200).json(activeApps);
    } catch (error) {
      console.error("Error in GET /loan-applications/active:", error);
      res.status(500).json({ error: "Failed to fetch active loan applications." });
    }
  });


  // GET interviews
  router.get("/interviews", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const interviews = await loanAppService.getInterviewList(repo);
      res.status(200).json(interviews);
    } catch (error) {
      console.error("Error fetching interviews:", error);
      res.status(500).json({ error: "Failed to fetch interviews." });
    }
  });

  router.get("/archive", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const allApps = await loanAppService.getAllApplications(repo);
      const deniedApps = allApps.filter((app) => app.status === "Denied" || app.status === "Denied by LO");

      res.status(200).json(deniedApps);
    } catch (error) {
      console.error("Error in GET /loan-applications/archive:", error);
      res.status(500).json({ error: "Failed to fetch archived applications." });
    }
  });

  // GET application status stats
  router.get("/applicationStatus-stats", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const stats = await loanAppService.getStatusStats(repo);
      res.status(200).json(stats);
    } catch (error) {
      console.error("Error fetching loan stats:", error);
      res.status(500).json({ error: "Failed to fetch statistics." });
    }
  });

  // GET loan type stats
  router.get("/loan-type-stats", authenticateToken, authorizeRole("loan officer", "head", "manager"), async (req, res) => {
    try {
      const stats = await loanAppService.getLoanTypeStats(repo);
      res.status(200).json(stats);
    } catch (error) {
      console.error("Error fetching loan type stats:", error);
      res.status(500).json({ error: "Failed to fetch loan type statistics." });
    }
  });

  // GET application by ID for tracking
  router.get("/:applicationId", async (req, res) => {
    try {
      const { applicationId } = req.params;
      const application = await loanAppService.getApplicationById(repo, applicationId);
  
      if (!application) {
        return res.status(404).json({ error: "Application not found." });
      }
  
      res.status(200).json(application);
    } catch (error) {
      console.error("Error fetching loan application by ID:", error);
      res.status(500).json({ error: "Failed to fetch loan application." });
    }
  });
  return router;
};
