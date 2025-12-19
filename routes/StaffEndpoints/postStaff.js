const express = require("express");
const router = express.Router();
const { upload, processUploadedDocs } = require("../../utils/uploadConfig");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const userRepository = require("../../repositories/staffRepository");
const { createUser, loginUser } = require("../../services/staffService");
const sharp = require("sharp");
const bcrypt = require("bcrypt");
const { decrypt, encrypt } = require('../../utils/crypt'); 
const logRepository = require("../../repositories/logRepository");

module.exports = (db) => {
  const repo = userRepository(db);
  const logRepo = logRepository(db);

  // Create a staff user (head only)
  router.post("/", authenticateToken, authorizeRole("head", "sysad"), async (req, res) => {
    try {
      const { newUser, tempPassword } = await createUser(req.body, req.user?.username, repo);
  
      await logRepo.insertActivityLog({
        userId: req.user.userId,
        name: req.user.name,
        role: req.user.role,
        action: "CREATE_USER",
        description: `Created new user: ${newUser.name} (${newUser.role})`,
      });

      const decryptedEmail = decrypt(newUser.email);
      const decryptedPhone = decrypt(newUser.phoneNumber);

      // Respond with user data including status
      res.status(201).json({
        message: "User created",
        user: {
          userId: newUser.userId,
          name: newUser.name,
          email: decryptedEmail,         
          phoneNumber: decryptedPhone,  
          role: newUser.role,
          username: newUser.username,
          profilePic: newUser.profilePic || null,
          status: newUser.status,
        },
        credentials: {
          username: newUser.username,
          tempPassword: tempPassword,
        },
      });
    } catch (error) {
      console.error("Error adding user:", error);
      res.status(400).json({ error: error.message });
    }
  });
  

  router.post(
    "/:userId/upload-profile",
    authenticateToken,
    upload.single("profilePic"),
    async (req, res) => {
      const { userId } = req.params;
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
        await repo.updateProfilePic(userId, profilePic.filePath);
  
        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: req.user.name,
          role: req.user.role,
          action: "UPLOAD_PROFILE_PIC",
          description: `Uploaded profile picture for userId: ${userId}`,
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

  // Staff login
  router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password are required" });
  
    try {
      const result = await loginUser(username, password, repo);
      const user = result.user;
  
      // Prevent inactive login
      if ((user.status || "").toLowerCase() === "inactive") {
        return res.status(403).json({
          error: "Your account is inactive. Please contact the administrator.",
        });
      }
  
      res.json({ message: "Login successful", ...result });
    } catch (err) {
      console.error("Login error:", err.message);
      // If username/password is wrong, throw 401
      res.status(401).json({ error: err.message });
    }
  });  

 // Generate OTP for staff login (with encryption)
 router.post('/generate-login-otp', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Check if user exists in MongoDB
    const user = await db.collection('users').findOne({ userId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    const encryptedOtp = encrypt(otp);
    
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.collection('login_otps').updateOne(
      { userId },
      { 
        $set: { 
          otp: encryptedOtp,
          expiresAt,
          createdAt: new Date()
        }
      },
      { upsert: true } 
    );

    console.log(`OTP generated for user ${userId}, expires at ${expiresAt}`);

    res.status(200).json({ 
      otp, 
      expiresAt,
      message: 'OTP generated successfully' 
    });

  } catch (error) {
    console.error('Generate OTP error:', error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

// Verify OTP for staff login (with decryption)
router.post('/verify-login-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ error: 'User ID and OTP are required' });
    }

    const otpRecord = await db.collection('login_otps').findOne({ userId });

    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid OTP or OTP not found' });
    }

    if (new Date() > new Date(otpRecord.expiresAt)) {
      // Delete expired OTP
      await db.collection('login_otps').deleteOne({ userId });
      return res.status(400).json({ error: 'OTP has expired' });
    }

    const decryptedOtp = decrypt(otpRecord.otp);

    if (decryptedOtp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    
    await db.collection('login_otps').deleteOne({ userId });

    console.log(`OTP verified successfully for user ${userId}`);

    res.status(200).json({ 
      success: true,
      message: 'OTP verified successfully' 
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

  // Check if staff email is available
  router.post("/check-email", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
      const existingUser = await repo.findByEmail(email);
      if (existingUser) return res.status(409).json({ error: "Email already in use." });
      res.status(200).json({ message: "Email is available" });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Check if staff phone number is available
  router.post("/check-phone", async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    try {
      const existingUser = await repo.findByPhoneNumber(phoneNumber);
      if (existingUser) return res.status(409).json({ error: "Phone number already in use." });
      res.status(200).json({ message: "Phone number is available" });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Check if staff name is available (case-insensitive exact match)
  router.post("/check-name", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    try {
      const existingUser = await repo.findByName(name.trim());
      if (existingUser) return res.status(409).json({ error: "Name already in use." });
      res.status(200).json({ message: "Name is available" });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post(
    "/reset-password/:userId",
    authenticateToken,
    authorizeRole("sysad"),
    async (req, res) => {
      const { userId } = req.params;
  
      try {
        // Find the user using the repository
        const user = await repo.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });
  
        // Generate a secure random password
        const generateRandomPassword = (length = 12) => {
          const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
          let password = "";
          for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return password;
        };
  
        const defaultPassword = generateRandomPassword();
  
        // Hash the password
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  
        // Update user password in the database and mark first login
        await repo.updateUserPassword(userId, hashedPassword, { isFirstLogin: true });
  
        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: req.user.name,
          role: req.user.role,
          action: "RESET_PASSWORD",
          description: `Reset password for userId: ${userId} (${user.name})`,
        });
  
        // Return the generated password to be sent via email
        return res.json({ message: "Password reset successfully", defaultPassword });
      } catch (err) {
        console.error("Error resetting password:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );
  

  return router;
};
