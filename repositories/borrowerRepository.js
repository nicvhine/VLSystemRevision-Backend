module.exports = (db) => {
  const borrowers = db.collection("borrowers_account");
  const applications = db.collection("loan_applications");
  const loans = db.collection("loans");

  return {
    // Borrower queries
    findByUsername: (username) => borrowers.findOne({ username }),
    findByEmail: (email) => borrowers.findOne({ email }),
    findByUsernameAndEmail: (username, email) =>
      borrowers.findOne({ username, email }),
    findByBorrowersId: (borrowersId) => borrowers.findOne({ borrowersId }),
    insertBorrower: (borrower) => borrowers.insertOne(borrower),

    // Added combined username/email search
    findByUsernameOrEmail: async (identifier) =>
      borrowers.findOne({
        $or: [{ username: identifier }, { email: identifier }],
      }),

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
