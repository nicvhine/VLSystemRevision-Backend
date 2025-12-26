const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { decrypt, encrypt } = require("../utils/crypt");
const { generateBorrowerId } = require("../utils/generator");
const { generateBorrowerUsername } = require("../utils/username");
const otpStore = require("../utils/otpStore");
const { BACKEND_URL } = require("../config");
const borrowerRepository = require("../repositories/borrowerRepository");
const borrowerSchema = require("../schemas/borrowerSchema");

// Create borrower
async function createBorrower(data, db) {
  const repo = borrowerRepository(db);
  const { name, email, contactNumber, username, password } = data;

  if (!name || !email || !contactNumber || !username || !password)
    throw new Error("Name, email, contact number, username, and password are required");

  if (!name.trim().includes(" "))
    throw new Error("Please provide full name (first and last)");

  // Normalize inputs
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = contactNumber.trim();
  const normalizedName = name.trim();

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate unique borrower ID
  const borrowersId = await generateBorrowerId(db.collection("borrowers_account"));

  // Validate with schema
  borrowerSchema.parse({
    borrowersId,
    name: normalizedName,
    role: "borrower",
    username,
    password: hashedPassword,
    email: normalizedEmail,
    phoneNumber: normalizedPhone,
  });

  // Create borrower object
  const borrower = {
    borrowersId,
    name: encrypt(normalizedName),
    role: "borrower",
    username,
    password: hashedPassword,
    email: encrypt(normalizedEmail),
    phoneNumber: encrypt(normalizedPhone),
    profilePic: null,
    createdDate: new Date(),
  };

  // Insert into DB
  await repo.insertBorrower(borrower);

  return { borrower, email: normalizedEmail };
}

// Login borrower
async function loginBorrower(username, password, db, jwtSecret) {
  if (!username || !password)
    throw new Error("Username and password are required");

  const repo = borrowerRepository(db);
  const borrower = await repo.findByUsername(username);
  if (!borrower) throw new Error("Invalid credentials");

  const isMatch = await bcrypt.compare(password, borrower.password);
  if (!isMatch) throw new Error("Invalid credentials");

  const token = jwt.sign(
    { borrowersId: borrower.borrowersId, role: "borrower" },
    jwtSecret,
    { expiresIn: "1h" }
  );

  return {
    message: "Login successful",
    name: decrypt(borrower.name),
    username: borrower.username,
    phoneNumber: decrypt(borrower.phoneNumber),
    email: decrypt(borrower.email),
    role: "borrower",
    profilePic: borrower.profilePic || null,
    borrowersId: borrower.borrowersId,
    passwordChanged: borrower.passwordChanged === true,
    token,
  };
}

// Forgot password
async function forgotPassword(username, email, db) {
  if (!username || !email) throw new Error("Username and email are required");

  const repo = borrowerRepository(db);
  const borrower = await repo.findByUsernameAndEmail(username, email);
  if (!borrower)
    throw new Error("No account found with that username and email");

  return {
    message: "Borrower found",
    borrowersId: borrower.borrowersId,
    username: borrower.username,
    email: borrower.email,
  };
}

// Send OTP (for registration via SMS) - accepts contactNumber
async function sendOtp(contactNumber, db) {
  if (!contactNumber) throw new Error("Contact number is required");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store OTP with contact number as key (for registration)
  otpStore[contactNumber] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  // Format phone number for Semaphore API
  const formattedPhone = contactNumber.startsWith("+") 
    ? contactNumber 
    : `+63${contactNumber.slice(1)}`; // Remove leading 0 and add +63

  const message = `Your Vistula System verification code is ${otp}. It will expire in 5 minutes.`;

  try {
    const response = await fetch("https://api.semaphore.co/api/v4/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: process.env.SEMAPHORE_API_KEY,
        number: formattedPhone,
        message,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Semaphore error:", data);
      throw new Error("Failed to send OTP via SMS");
    }

    console.log(`OTP sent via Semaphore to ${formattedPhone}: ${otp}`);
    return { message: "OTP sent to your phone number", success: true };
  } catch (err) {
    console.error("Failed to send OTP:", err);
    throw new Error("Failed to send OTP. Please try again.");
  }
}

// Verify OTP (for registration)
async function verifyOtp(contactNumber, otp) {
  if (!contactNumber || !otp) throw new Error("Contact number and OTP are required");

  const record = otpStore[contactNumber];
  if (!record) throw new Error("No OTP found");
  if (Date.now() > record.expires) {
    delete otpStore[contactNumber];
    throw new Error("OTP expired");
  }
  if (record.otp !== otp) throw new Error("Invalid OTP");

  // Mark as verified but don't delete yet - will be deleted after registration
  otpStore[contactNumber].verified = true;
  return { message: "OTP verified successfully", success: true };
}

// Clear OTP after successful registration
function clearOtp(contactNumber) {
  if (otpStore[contactNumber]) {
    delete otpStore[contactNumber];
  }
}

// Send Login OTP (for existing users)
async function sendLoginOtp(borrowersId, db) {
  if (!borrowersId) throw new Error("borrowersId is required");

  const repo = borrowerRepository(db);
  const borrower = await repo.findByBorrowersId(borrowersId);
  if (!borrower) throw new Error("Borrower not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[borrowersId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  const phoneNumber = decrypt(borrower.phoneNumber);
  const formattedPhone = phoneNumber.startsWith("+") 
    ? phoneNumber 
    : `+63${phoneNumber.slice(1)}`;

  const message = `Your Vistula System login OTP is ${otp}. It will expire in 5 minutes.`;

  try {
    const response = await fetch("https://api.semaphore.co/api/v4/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: process.env.SEMAPHORE_API_KEY,
        number: formattedPhone,
        message,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Semaphore error:", data);
      throw new Error("Failed to send OTP via SMS");
    }

    console.log(`OTP sent via Semaphore to ${formattedPhone}: ${otp}`);
    return { message: "OTP sent to your phone number" };
  } catch (err) {
    console.error("Failed to send OTP:", err);
    throw new Error("Failed to send OTP. Please try again.");
  }
}

// Verify Login OTP
async function verifyLoginOtp(borrowersId, otp) {
  if (!borrowersId || !otp) throw new Error("borrowersId and OTP are required");

  const record = otpStore[borrowersId];
  if (!record) throw new Error("No OTP found for this borrower");

  if (Date.now() > record.expires) {
    delete otpStore[borrowersId];
    throw new Error("OTP has expired");
  }

  if (record.otp !== otp) throw new Error("Invalid OTP");

  delete otpStore[borrowersId];
  return { message: "OTP verified successfully", success: true };
}

// Get borrower by ID
async function getBorrowerById(borrowersId, db) {
  const repo = borrowerRepository(db);
  const borrower = await repo.findBorrowerById(borrowersId);

  if (!borrower) return null;

  const activeLoan = await repo.findActiveLoanByBorrowerId(borrowersId);
  const profilePicUrl = borrower.profilePic?.filePath
    ? `${BACKEND_URL}/${borrower.profilePic.filePath.replace(/\\/g, "/")}`
    : null;

  return {
    name: decrypt(borrower.name),
    username: borrower.username,
    email: decrypt(borrower.email),
    role: "borrower",
    assignedCollector: borrower.assignedCollector,
    borrowersId: borrower.borrowersId,
    profilePic: profilePicUrl,
    status: activeLoan ? "Active" : "Inactive",
  };
}

// Find borrower account by username or email
async function findBorrowerAccount(identifier, db) {
  if (!identifier) throw new Error("Username or email is required");

  const repo = borrowerRepository(db);
  const borrower = await repo.findByUsernameOrEmail(identifier);

  if (!borrower) throw new Error("Account not found");

  return {
    message: "Account found.",
    borrower: {
      id: borrower.borrowersId,
      name: borrower.name,
      email: decrypt(borrower.email),
      username: borrower.username,
      phoneNumber: decrypt(borrower.phoneNumber),
    },
  };
}

module.exports = {
  createBorrower,
  loginBorrower,
  forgotPassword,
  sendOtp,
  verifyOtp,
  sendLoginOtp,
  verifyLoginOtp,
  getBorrowerById,
  findBorrowerAccount,
  clearOtp,
};