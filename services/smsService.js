const axios = require('axios');
require('dotenv').config();

const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;

function formatPhoneNumber(number) {
  let cleaned = number.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '63' + cleaned.slice(1);
  } else if (!cleaned.startsWith('63')) {
    cleaned = '63' + cleaned;
  }
  return cleaned;
}

async function sendSMS(to, message, sender = 'Gethsemane') {
  const formatted = formatPhoneNumber(to);
  try {
    const response = await axios.post('https://api.semaphore.co/api/v4/messages', {
      apikey: SEMAPHORE_API_KEY,
      number: formatted,
      message,
      sendername: sender
    });

    console.log(`SMS sent to ${formatted}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`Failed to send SMS to ${formatted}:`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = { sendSMS, formatPhoneNumber };
