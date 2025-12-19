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

function generateTempPassword(length = 12) {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
}

// Create borrower
async function createBorrower(data, db) {
  const repo = borrowerRepository(db);
  const { name, role, applicationId, assignedCollector, assignedCollectorId } = data;

  if (!name || !role || !applicationId)
    throw new Error("Name, role, and applicationId are required");

  if (!name.trim().includes(" "))
    throw new Error("Please provide full name (first and last)");

  const application = await repo.findApplicationById(applicationId);
  if (!application) throw new Error("Application not found");

  // Decrypt and normalize email & phone
  let decryptedEmail = decrypt(application.appEmail);
  let decryptedPhone = decrypt(application.appContact);
  let decryptName = decrypt(name);

  if (!decryptedEmail || !decryptedPhone)
    throw new Error("Application email or phone is missing");

  // Generate unique username and borrower ID
  const username = await generateBorrowerUsername(name, db.collection("borrowers_account"));
  const borrowersId = await generateBorrowerId(db.collection("borrowers_account"));
  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const profilePicUrl = application.profilePic
    ? application.profilePic.filePath
      ? application.profilePic.filePath.replace(/\\/g, "/")
      : application.profilePic
    : null;
  
  // Remove whitespace, normalize
  const normalizedEmail = decryptedEmail.trim().toLowerCase();
  const normalizedPhone = decryptedPhone.trim();
  const normalizedName = decryptName.trim();

  borrowerSchema.parse({
    borrowersId,
    name: normalizedName,
    role,
    username,
    password: hashedPassword,
    isFirstLogin: true,
    assignedCollector,
    assignedCollectorId,
    email: normalizedEmail, 
    phoneNumber: normalizedPhone,
    profilePic: profilePicUrl,
  });

  // Build borrower object with encrypted fields
  const borrower = {
    borrowersId,
    name: encrypt(name),
    role,
    username,
    password: hashedPassword,
    isFirstLogin: true,
    assignedCollector,
    assignedCollectorId,
    email: encrypt(normalizedEmail),
    phoneNumber: encrypt(normalizedPhone),
    profilePic: profilePicUrl,
    createdDate: new Date(),
  };

  // Save borrower to DB
  await repo.insertBorrower(borrower);

  // Update application with borrower info
  await repo.updateApplicationWithBorrower(applicationId, borrowersId, username);

  return { borrower, tempPassword, email: normalizedEmail };
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
    username: decrypt(borrower.username),
    phoneNumber: decrypt(borrower.phoneNumber),
    email: decrypt(borrower.email),
    role: "borrower",
    profilePic: borrower.profilePic || null,
    borrowersId: borrower.borrowersId,
    isFirstLogin: borrower.isFirstLogin !== false,
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

//Send Login OTP
async function sendLoginOtp(borrowersId, db) {
  if (!borrowersId) throw new Error("borrowersId is required");

  const repo = require("../repositories/borrowerRepository")(db);
  const borrower = await repo.findByBorrowersId(borrowersId);
  if (!borrower) throw new Error("Borrower not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[borrowersId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  const phoneNumber = decrypt(borrower.phoneNumber); 
  const formattedPhone = phoneNumber.startsWith("+") ? phoneNumber : `+63${phoneNumber.slice(-10)}`;

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

async function verifyLoginOtp(borrowersId, otp) {
  if (!borrowersId || !otp) throw new Error("borrowersId and OTP are required");

  const record = otpStore[borrowersId];
  if (!record) throw new Error("No OTP found for this borrower");

  if (Date.now() > record.expires) {
    delete otpStore[borrowersId];
    throw new Error("OTP has expired");
  }

  if (record.otp !== otp) throw new Error("Invalid OTP");

  // OTP is valid — remove it from store
  delete otpStore[borrowersId];

  return { message: "OTP verified successfully" };
}

// Send OTP
async function sendOtp(borrowersId, db) {
  if (!borrowersId) throw new Error("borrowersId is required");

  const repo = borrowerRepository(db);
  const borrower = await repo.findByBorrowersId(borrowersId);
  if (!borrower) throw new Error("Borrower not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[borrowersId] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  console.log(`OTP for ${borrower.email}: ${otp}`);
  return { message: "OTP sent to your email address" };
}

// Verify OTP
async function verifyOtp(borrowersId, otp) {
  if (!borrowersId || !otp) throw new Error("borrowersId and otp are required");

  const record = otpStore[borrowersId];
  if (!record) throw new Error("No OTP found");
  if (Date.now() > record.expires) throw new Error("OTP expired");
  if (record.otp !== otp) throw new Error("Invalid OTP");

  delete otpStore[borrowersId];
  return { message: "OTP verified successfully" };
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
    username: decrypt(borrower.username),
    email: decrypt(borrower.email),
    role: "borrower",
    assignedCollector: borrower.assignedCollector,
    isFirstLogin: borrower.isFirstLogin !== false,
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
  sendLoginOtp,
  verifyLoginOtp,
  verifyOtp,
  getBorrowerById,
  findBorrowerAccount,
};
