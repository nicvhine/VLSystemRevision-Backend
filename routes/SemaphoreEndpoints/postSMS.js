const express = require('express');
const router = express.Router();
const axios = require('axios');
const { formatPhoneNumber } = require('../../services/smsService');
require('dotenv').config();

const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;

module.exports = (db) => {

  router.post('/otpCode', async (req, res) => {
  const { phoneNumber, code } = req.body;

  if (!phoneNumber || !code) {
    return res.status(400).json({ success: false, error: 'Missing phone number or code.' });
  }

  const to = formatPhoneNumber(phoneNumber);
  const message = `OTP: ${code}. Valid until ${new Date(Date.now() + 15 * 60000).toLocaleTimeString()}. Do not share this code.`;

  try {
    const response = await axios.post('https://api.semaphore.co/api/v4/messages', {
      apikey: SEMAPHORE_API_KEY,
      number: to,
      message,
      sendername: 'Gethsemane'
    });

    console.log('SMS sent:', response.data);
    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error('SMS send error (login):', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message || 'Failed to send SMS'
    });
  }
});

router.post("/sendOtp", async (req, res) => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({ error: "Missing phone number or OTP" });
  }

  try {
    const response = await axios.post(
      "https://api.semaphore.co/api/v4/messages",
      {
        apikey: process.env.SEMAPHORE_API_KEY,
        number: phoneNumber,
        message: `Your OTP is ${otp}. Please verify within 5 minutes.`,
        sendername: "Gethsemane"
      }
    );

    return res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error("Semaphore error:", error.response?.data || error.message);
    return res.status(500).json({ error: "Failed to send SMS" });
  }
});

return router;
}
