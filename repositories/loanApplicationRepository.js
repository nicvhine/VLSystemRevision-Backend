module.exports = (db) => {
  const loanApplications = db.collection("loan_applications");
  const agents = db.collection("agents");

  return {
    loanApplications,
    agents,

    // Insert a new loan application
    async insertLoanApplication(application) {
      return await loanApplications.insertOne(application);
    },

    // Fetch all loan applications
    async getAllApplications() {
      return await loanApplications.find().toArray();
    },

    // Check for existing pending application by applicant details
    async findPendingByApplicant(appName, appDob, appContact, appEmail) {
      return await loanApplications.findOne({
        appName: appName.trim(),
        appDob: appDob.trim(),
        appContact: appContact.trim(),
        appEmail: appEmail.trim(),
        status: "Pending",
      });
    },

    // Find agent by id
    async findAgentById(agentId) {
      return await agents.findOne({ agentId });
    },

    // Get interviews with minimal fields
    async getInterviewList() {
      return await loanApplications
        .find({ interviewDate: { $exists: true } })
        .project({
          applicationId: 1,
          appName: 1,
          interviewDate: 1,
          interviewTime: 1,
          status: 1,
          appAddress: 1,
          _id: 0,
        })
        .toArray();
    },

    // Count applications by status
    async countByStatus(statusRegex) {
      return await loanApplications.countDocuments({
        status: { $regex: statusRegex, $options: "i" },
      });
    },

    // Aggregate loan type counts
    async getLoanTypeStats() {
      return await loanApplications
        .aggregate([
          {
            $group: {
              _id: "$loanType",
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              loanType: "$_id",
              count: 1,
            },
          },
        ])
        .toArray();
    },

    // Find one application by id
    async getApplicationById(applicationId) {
      return await loanApplications.findOne({ applicationId });
    },

    async deleteMany(filter) {
      const result = await loanApplications.deleteMany(filter);
      return result.deletedCount; 
    },
  };
};
