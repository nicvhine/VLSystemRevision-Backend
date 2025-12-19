module.exports = (db) => {
  const collections = db.collection("collections");
  const loans = db.collection("loans");
  const payments = db.collection("payments");
  const paymongoPayments = db.collection("paymongo-payments");

  return {
    // Collections
    async findCollection(referenceNumber) {
      return await collections.findOne({ referenceNumber });
    },

    async findLoanCollections(loanId) {
      return await collections.find({ loanId }).sort({ collectionNumber: 1 }).toArray();
    },

    async updateCollection(referenceNumber, update) {
      return await collections.updateOne({ referenceNumber }, { $set: update });
    },

    // Loans
    async updateLoan(loanId, update) {
      return await loans.updateOne({ loanId }, { $set: update });
    },

    async incrementLoan(loanId, update) {
      return await loans.updateOne({ loanId }, { $inc: update });
    },

    // Payments
    async insertPayments(paymentLogs) {
      return await payments.insertMany(paymentLogs);
    },

    async getPaymentsByLoan(loanId) {
      return await payments.find({ loanId }).sort({ datePaid: -1 }).toArray();
    },

    async getPaymentsByBorrower(borrowersId) {
      return await payments.find({ borrowersId }).sort({ datePaid: -1 }).toArray();
    },

    // PayMongo payments
    async createPaymongoPayment(data) {
      return await paymongoPayments.insertOne(data);
    },

    async findPaymongoPayment(referenceNumber) {
      return await paymongoPayments.findOne({ referenceNumber });
    },

    async updatePaymongoPayment(referenceNumber, update) {
      return await paymongoPayments.updateOne({ referenceNumber }, { $set: update });
    },

    async getPaymongoPaymentsByLoan(loanId) {
      return await paymongoPayments.find({ loanId }).sort({ createdAt: -1 }).toArray();
    },

    async findLoan(loanId) {
      return await loans.findOne({ loanId });
    },

    // Insert new collections (used during recalculation or regeneration)
    async insertCollections(newCollections) {
      if (!Array.isArray(newCollections)) {
        throw new Error("insertCollections expects an array of collection documents");
      }
      return await collections.insertMany(newCollections);
    },
    
    async getPaymongoPaymentsByBorrowers(borrowerIds) {
      return await payments
        .find({
          borrowersId: { $in: borrowerIds },
          mode: { $in: ["Paymongo"] } 
        })
        .sort({ createdAt: -1 })
        .toArray();
    }
    

  };
};
