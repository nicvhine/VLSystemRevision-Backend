const { generatePenaltyEndorsementId } = require("../utils/generator");

module.exports = (repo, db) => {
  return {
    async endorsePenalty(collection, formData) {
      const penaltyRate =
        collection.status === "Past Due" ? 0.02 :
        collection.status === "Overdue" ? 0.05 : 0;
    
      const penaltyAmount = collection.periodAmount * penaltyRate;
      const finalAmount = collection.periodAmount + penaltyAmount;

      const endorsementId = await generatePenaltyEndorsementId(db.collection("penalty_endorsements"));

      const newEndorsement = {
        endorsementId,
        referenceNumber: collection.referenceNumber,
        loanId: collection.loanId,
        paidAmount: collection.paidAmount,
        borrowerName: collection.name,
        status: "Pending",
        endorsedBy: collection.collector, 
        collectorId: collection.collectorId, 
        reason: formData.reason,
        penaltyAmount,
        penaltyRate,
        finalAmount,
        collectionStatus: collection.status,
        dateEndorsed: new Date(),
        dateReviewed: null,
      };
    
      const insertedId = await repo.create(newEndorsement);
      return { insertedId, penaltyAmount, penaltyRate };
    },

    async getAllEndorsements() {
      return await repo.getAll();
    },

    async approveEndorsement(id, approverId, remarks = null) {
      const endorsement = await repo.getById(id);
      if (!endorsement) throw new Error("Endorsement not found");
    
      const collection = await db.collection("collections").findOne({ referenceNumber: endorsement.referenceNumber });
      if (!collection) throw new Error("Collection not found");
    
      const { periodAmount: baseAmount, status: oldStatus, loanId, paidAmount } = collection;
    
      const penaltyRate =
        oldStatus === "Past Due" ? 0.02 :
        oldStatus === "Overdue" ? 0.05 : 0;
    
      const penaltyAmount = baseAmount * penaltyRate;
      const newPeriodAmount = baseAmount + penaltyAmount;
      const newPeriodBalance = newPeriodAmount - paidAmount;
    
      let updatedStatus = "Unpaid";
      if (newPeriodBalance <= 0) updatedStatus = "Paid";
      else if (oldStatus === "Past Due") updatedStatus = "Past Due";
      else if (oldStatus === "Overdue") updatedStatus = "Overdue";
    
      // Update collection with penalty info
      await db.collection("collections").updateOne(
        { referenceNumber: collection.referenceNumber },
        {
          $set: {
            penaltyAmount,
            penaltyRate,
            periodAmount: newPeriodAmount,
            periodBalance: newPeriodBalance,
            status: updatedStatus,
            lastPenaltyUpdated: new Date(),
          }
        }
      );
    
      await db.collection("loans").updateOne(
        { loanId },
        { $inc: { balance: penaltyAmount } } 
      );
    
      // Update endorsement status
      const updateData = {
        status: "Approved",
        approvedBy: approverId,
        dateReviewed: new Date(),
        remarks,
      };
      await repo.update(id, updateData);
    
      return {
        ...updateData,
        penaltyAmount,
        penaltyRate,
        newPeriodAmount,
        newPeriodBalance,
        updatedStatus,
      };
    },

    async rejectEndorsement(id, approverId, remarks = null) {
      const endorsement = await repo.getById(id);
      if (!endorsement) throw new Error("Endorsement not found");

      const updateData = {
        status: "Rejected",
        approvedBy: approverId,
        dateReviewed: new Date(),
      };

      await repo.update(id, updateData);
      return updateData;
    },
  };
};
