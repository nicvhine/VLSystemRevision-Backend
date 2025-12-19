const { ObjectId } = require("mongodb");

class ClosureRepo {
  constructor(db) {
    this.collection = db.collection("closure_endorsements");
  }

  async insertClosure(closure) {
    await this.collection.insertOne(closure);
    return { ...closure };
  }

  async getAllClosure() {
    return this.collection.find({}).toArray();
  }

  async getClosureById(endorsementId) {
    return this.collection.findOne({ endorsementId });
  }

  // NEW: get closure by loanId
  async getClosureByLoanId(loanId) {
    return this.collection.findOne({ loanId });
  }

  async updateClosure(endorsementId, updateFields) {
    const result = await this.collection.findOneAndUpdate(
      { endorsementId },
      { $set: updateFields },
      { returnDocument: "after" }
    );
    return result.value;
  }

  async deleteClosure(endorsementId) {
    return this.collection.deleteOne({ endorsementId });
  }
}

module.exports = ClosureRepo;
