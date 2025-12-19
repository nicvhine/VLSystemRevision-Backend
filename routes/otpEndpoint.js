const express = require("express");
const router = express.Router();
const otpSchema = require("../schemas/otpSchema");

module.exports = (db) => {
  const otpCollection = db.collection("otps"); 

  // Generate OTP
  router.post("/generate-otp", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required." });

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // expires in 5 min

      const validatedData = otpSchema.parse({
        email,
        otp,
        expiresAt,
        verified: false,
      });

      await otpCollection.deleteMany({ email });

      // save new OTP
      await otpCollection.insertOne(validatedData);

      res.status(201).json({
        message: "OTP generated successfully",
        otp,
        expiresIn: 5 * 60,
      });
    } catch (err) {
      console.error("Error generating OTP:", err);
      res.status(500).json({ error: "Failed to generate OTP" });
    }
  });

  // Verify OTP
  router.post("/verify-otp", async (req, res) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp)
        return res.status(400).json({ error: "Email and OTP are required." });

      const record = await otpCollection.findOne({ email, otp });
      if (!record) return res.status(400).json({ error: "Invalid OTP." });

      if (record.expiresAt < new Date())
        return res.status(400).json({ error: "OTP expired." });

      await otpCollection.updateOne(
        { _id: record._id },
        { $set: { verified: true } }
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Error verifying OTP:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
