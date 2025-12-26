const { decrypt } = require("../utils/crypt");

module.exports = (db) => {
  const borrowers = db.collection("borrowers_account");
  const applications = db.collection("loan_applications");
  const loans = db.collection("loans");

  return {
    // Borrower queries
    findByUsername: (username) => borrowers.findOne({ username }),
    
    findByEmail: async (email) => {
      const allBorrowers = await borrowers.find().toArray();
      return allBorrowers.find(b => {
        try {
          return decrypt(b.email) === email;
        } catch {
          return false;
        }
      }) || null;
    },

    findByUsernameAndEmail: async (username, email) => {
      const allBorrowers = await borrowers.find().toArray();
      return allBorrowers.find(b => {
        try {
          return b.username === username && decrypt(b.email) === email;
        } catch {
          return false;
        }
      }) || null;
    },

    findByBorrowersId: (borrowersId) => borrowers.findOne({ borrowersId }),
    
    insertBorrower: (borrower) => borrowers.insertOne(borrower),

    // Combined username/email search with encryption handling
    findByUsernameOrEmail: async (identifier) => {
      // First try username lookup (not encrypted)
      const byUsername = await borrowers.findOne({ username: identifier });
      if (byUsername) return byUsername;

      // Then check email (encrypted)
      const allBorrowers = await borrowers.find().toArray();
      return allBorrowers.find(b => {
        try {
          return decrypt(b.email) === identifier;
        } catch {
          return false;
        }
      }) || null;
    },

    // Phone number search with encryption handling
    findByPhoneNumber: async (phoneNumber) => {
      const allBorrowers = await borrowers.find().toArray();
      const normalizedPhone = phoneNumber.replace(/\D/g, "");
      
      return allBorrowers.find(b => {
        try {
          const decryptedPhone = decrypt(b.phoneNumber).replace(/\D/g, "");
          return decryptedPhone === normalizedPhone;
        } catch {
          return false;
        }
      }) || null;
    },

    // Application queries
    findApplicationById: (applicationId) =>
      applications.findOne({ applicationId }),
    
    updateApplicationWithBorrower: (applicationId, borrowersId, username) =>
      applications.updateOne(
        { applicationId },
        { $set: { borrowersId, username } }
      ),

    // Loan queries
    findBorrowerById: (borrowersId) => borrowers.findOne({ borrowersId }),
    
    findActiveLoanByBorrowerId: (borrowersId) =>
      loans.findOne({ borrowersId, status: "Active" }),

    // Profile picture update
    updateBorrowerProfilePic: (borrowersId, profilePic) =>
      borrowers.updateOne({ borrowersId }, { $set: { profilePic } }),
  };
};