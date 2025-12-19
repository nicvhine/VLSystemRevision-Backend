async function calculatePenalty(collection) {
    const today = new Date();
    const due = new Date(collection.dueDate);
    const graceEnd = new Date(due);
    graceEnd.setDate(graceEnd.getDate() + 3); // 3-day grace period
  
    // If already paid on time
    if (collection.status === "Paid") return { ...collection, penalty: 0, paymentStatus: "Paid" };
  
    // Not yet due
    if (today <= graceEnd) {
      return { ...collection, penalty: 0, paymentStatus: "Within Grace Period" };
    }
  
    const daysLate = Math.floor((today - graceEnd) / (1000 * 60 * 60 * 24)); // days after grace
  
    let penaltyRate = 0;
    let paymentStatus = "On Time";
  
    if (daysLate > 0 && daysLate < 30) {
      penaltyRate = 0.02; // 2% past due
      paymentStatus = "Past Due";
    } else if (daysLate >= 30) {
      penaltyRate = 0.05; // 5% overdue
      paymentStatus = "Overdue";
    }
  
    const penalty = collection.periodAmount * penaltyRate;
    const updatedBalance = (collection.periodBalance || 0) + penalty;
  
    return {
      ...collection,
      penalty,
      daysLate,
      paymentStatus,
      updatedPeriodBalance: updatedBalance
    };
  }
  