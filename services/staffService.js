const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { padId } = require("../utils/generator");
const { generateStaffUsername } = require("../utils/username");
const { encrypt, decrypt } = require("../utils/crypt"); 

const JWT_SECRET = process.env.JWT_SECRET;

// Generate a secure random temporary password
function generateTempPassword(length = 12) {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
}

// Create a staff user and return temp password
async function createUser({ name, email, phoneNumber, role }, actor, repo) {
  if (!name || !email || !phoneNumber || !role)
    throw new Error("All fields are required.");

  if (!name.trim().includes(" "))
    throw new Error("Please enter a full name with first and last name.");

  const username = await generateStaffUsername(name, role, repo);
  if (!username) throw new Error("Cannot generate username.");

  // Uniqueness checks
  if (await repo.findByEmail(email.toLowerCase())) throw new Error("Email already registered.");
  if (await repo.findByPhoneNumber(phoneNumber)) throw new Error("Phone number already registered.");
  if (await repo.findByName(name.trim())) throw new Error("Name already registered.");

  const maxUser = await repo.findMaxUser();
  let nextId = 1;
  if (maxUser.length > 0 && !isNaN(maxUser[0].userIdNum))
    nextId = maxUser[0].userIdNum + 1;

  const userId = padId(nextId);
  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const newUser = {
    userId,
    name,
    email: encrypt(email.toLowerCase()),
    phoneNumber: encrypt(phoneNumber),
    role,
    username,
    password: hashedPassword,
    status: "Active",
    isFirstLogin: true,
  };

  await repo.insertUser(newUser);

  return { newUser, tempPassword };
}

// Authenticate staff user and return JWT plus profile
async function loginUser(username, password, repo) {
  const user = await repo.findByUsername(username);
  if (!user) throw new Error("Invalid credentials");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid credentials");

  const decryptedEmail = decrypt(user.email);
  const decryptedPhone = decrypt(user.phoneNumber);

  const token = jwt.sign(
    {
      userId: user.userId,
      role: user.role,
      username: user.username,
      email: decryptedEmail,
      phoneNumber: decryptedPhone,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  return {
    token,
    user: {
      userId: user.userId,
      username: user.username,
      name: user.name,
      email: decryptedEmail,
      phoneNumber: decryptedPhone,
      role: user.role,
      profilePic: user.profilePic || null,
      isFirstLogin: user.isFirstLogin !== false,
      status: user.status,
    },
  };
}

module.exports = { createUser, loginUser };
