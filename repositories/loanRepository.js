const { ObjectId } = require("mongodb");

module.exports = (db) => {
  const loanApplications = db.collection("loan_applications");
  const loans = db.collection("loans");
  const borrowers = db.collection("borrowers_account");
  const collections = db.collection("collections");

  return {
    // Find application by id
    findApplicationById: async (applicationId) =>
      await loanApplications.findOne({ applicationId }),

    // Check if a loan already exists for application
    findExistingLoan: async (applicationId) =>
      await loans.findOne({ applicationId }),

    // Find borrower by borrowersId
    findBorrowerById: async (borrowersId) =>
      await borrowers.findOne({ borrowersId }),

    // Get highest numeric loan id
    getMaxLoan: async () => {
      return await loans
        .aggregate([
          {
            $addFields: {
              loanIdNum: {
                $convert: {
                  input: {
                    $substrBytes: ["$loanId", 1, { $subtract: [{ $strLenBytes: "$loanId" }, 1] }],
                  },
                  to: "int",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
          { $sort: { loanIdNum: -1 } },
          { $limit: 1 },
        ])
        .toArray();
    },

    // Insert a new loan document
    insertLoan: async (loan) => await loans.insertOne(loan),

    // Bulk insert collection schedule
    insertCollections: async (collectionsData) =>
      await collections.insertMany(collectionsData),

    // Find active loans for a borrower
    findActiveLoansByBorrowerId: async (borrowersId) => {
      return await loans.find({ borrowersId, status: "Active" }).toArray();
    },

    // Update loan status
    updateLoanStatus: async (loanId, status) => {
      await loans.updateOne({ loanId }, { $set: { status } });
    },

    // Find collections by loanId
    findCollectionsByLoan: async (loanId) => {
      return await collections.find({ loanId }).toArray();
    },

    // Update collection status
    updateCollectionStatus: async (loanId, status) => {
      await collections.updateOne(
        { loanId },
        { $set: { status } }
      );
    },
  };
};
