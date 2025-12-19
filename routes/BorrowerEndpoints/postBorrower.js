const express = require('express');
const router = express.Router();
require('dotenv').config();
const logRepository = require("../../repositories/logRepository"); 
const notificationRepository = require("../../repositories/notificationRepository");
const { upload, processUploadedDocs } = require("../../utils/uploadConfig");
const sharp = require("sharp");
const borrowerRepository = require("../../repositories/borrowerRepository");

const JWT_SECRET = process.env.JWT_SECRET;
const {
  createBorrower,
  loginBorrower,
  forgotPassword,
  sendOtp,
  verifyOtp,
  sendLoginOtp,
  verifyLoginOtp,
  findBorrowerAccount,
} = require('../../services/borrowerService');
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');

module.exports = (db) => {
  const logRepo = logRepository(db); 
  const notifRepo = notificationRepository(db);
  const borrowerRepo = borrowerRepository(db);
  
  // Create borrower account
  router.post("/", authenticateToken, authorizeRole("manager"), async (req, res) => {
    try {
      const newBorrower = await createBorrower(req.body, db);

      const creatorName = req.user.name;

      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: req.user.name,
        role: req.user.role,
        action: "CREATE_BORROWER",
        description: `${creatorName} added a new borrower account: ${newBorrower.name}`,
      });

      // Notify loan officer about the new borrower account
      try {
        await notifRepo.insertLoanOfficerNotification({
          type: "borrower-account-created",
          title: "New Borrower Account Created",
          message: `${creatorName} has created a borrower account for ${newBorrower.borrower.name}. Application ID: ${req.body.applicationId}`,
          applicationId: req.body.applicationId,
          borrowersId: newBorrower.borrower.borrowersId,
          actor: {
            name: creatorName,
            role: "Manager",
          },
          read: false,
          viewed: false,
          createdAt: new Date(),
        });
        console.log("Loan officer notified of new borrower account.");
      } catch (notifyErr) {
        console.error("Failed to notify loan officer:", notifyErr.message);
      }

      res.status(201).json(newBorrower);
    } catch (err) {
      console.error("Error adding borrower:", err);
      res.status(400).json({ message: err.message });
    }
  });

  // Borrower login
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const response = await loginBorrower(username, password, db, JWT_SECRET);
      res.json(response);
    } catch (err) {
      console.error("Login error:", err.message);
      res.status(401).json({ error: err.message });
    }
  });

  router.post("/send-login-otp", async (req, res) => {
    try {
      const { borrowersId } = req.body;
      const result = await sendLoginOtp(borrowersId, db);
      res.json(result);
    } catch (err) {
      console.error("Send OTP error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/verify-login-otp", async (req, res) => {
    try {
      const { borrowersId, otp } = req.body;
      const result = await verifyLoginOtp(borrowersId, otp);
      res.json(result);
    } catch (err) {
      console.error("Verify login OTP error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Forgot password
  router.post("/forgot-password", async (req, res) => {
    try {
      const { username, email } = req.body;
      const result = await forgotPassword(username, email, db);
      res.json(result);
    } catch (err) {
      console.error("Forgot password error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Send OTP
  router.post("/send-otp", async (req, res) => {
    try {
      const { borrowersId } = req.body;
      const result = await sendOtp(borrowersId, db);
      res.json(result);
    } catch (err) {
      console.error("Send OTP error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Verify OTP
  router.post("/verify-otp", async (req, res) => {
    try {
      const { borrowersId, otp } = req.body;
      const result = await verifyOtp(borrowersId, otp);
      res.json(result);
    } catch (err) {
      console.error("Verify OTP error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Find borrower account (for login or password recovery)
  router.post("/find-account", async (req, res) => {
    try {
      const { identifier } = req.body;
      console.log("Incoming find-account request:", req.body);

      const result = await findBorrowerAccount(identifier, db);
      res.json(result);
    } catch (err) {
      console.error("Find account error:", err.message);
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // Upload borrower profile picture
  router.post(
    "/:borrowersId/upload-profile",
    authenticateToken,
    authorizeRole("borrower"),
    upload.single("profilePic"),
    async (req, res) => {
      const { borrowersId } = req.params;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      try {
        // Validate 2x2 dimensions (optional, 600x600)
        const metadata = await sharp(req.file.buffer).metadata();
        if (metadata.width !== 600 || metadata.height !== 600) {
          return res.status(400).json({
            error: "Profile picture must be 2x2 inches (600x600 pixels).",
          });
        }

        // Upload to Cloudinary
        const uploaded = await processUploadedDocs({ profilePic: [req.file] });
        const profilePic = uploaded[0];

        // Save path in DB
        await borrowerRepo.updateBorrowerProfilePic(borrowersId, profilePic.filePath);

        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.borrowersId || req.user.userId,
          name: req.user.name,
          role: req.user.role,
          action: "UPLOAD_PROFILE_PIC",
          description: `Uploaded profile picture for borrower: ${borrowersId}`,
        });

        res.status(200).json({
          message: "Profile uploaded successfully",
          profilePic,
        });
      } catch (err) {
        console.error("Error saving profile pic:", err);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // Remove borrower profile picture
  router.delete(
    "/:borrowersId/remove-profile",
    authenticateToken,
    authorizeRole("borrower"),
    async (req, res) => {
      const { borrowersId } = req.params;

      try {
        // Set profilePic to empty string in DB
        await borrowerRepo.updateBorrowerProfilePic(borrowersId, "");

        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.borrowersId || req.user.userId,
          name: req.user.name,
          role: req.user.role,
          action: "REMOVE_PROFILE_PIC",
          description: `Removed profile picture for borrower: ${borrowersId}`,
        });

        res.status(200).json({ message: "Profile picture removed successfully" });
      } catch (err) {
        console.error("Error removing profile pic:", err);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  return router;
};
