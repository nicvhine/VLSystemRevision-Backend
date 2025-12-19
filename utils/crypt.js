const crypto = require("crypto");
require('dotenv').config();

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const SECRET_KEY = Buffer.from(
  (process.env.ENCRYPTION_KEY || "").padEnd(32, "0").slice(0, 32)
);

// Encrypt a UTF-8 string into hex with IV prefix
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// Decrypt a hex string with IV prefix back to UTF-8
function decrypt(text) {
  if (!text) return "";
  try {
    const [ivHex, encryptedHex] = text.split(":");
    if (!ivHex || !encryptedHex) return text;
    const iv = Buffer.from(ivHex, "hex");
    const encryptedText = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("Decryption failed:", err.message);
    return text;
  }
}

module.exports = { encrypt, decrypt };
