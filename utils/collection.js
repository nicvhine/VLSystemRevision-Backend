// Apply overdue penalty after grace period to a collection item
function applyOverduePenalty(collection, penaltyRate = 0.02, graceDays = 3) {
    const now = new Date();
    const due = new Date(collection.dueDate);
    const graceDate = new Date(due);
    graceDate.setDate(graceDate.getDate() + graceDays);
  
    if (collection.balance > 0 && now > graceDate && collection.status !== 'Paid' && collection.status !== 'Overdue') {
      const penaltyAmount = (collection.periodAmount || 0) * penaltyRate;
      const newBalance = (collection.balance || 0) + penaltyAmount;
  
      return {
        ...collection,
        status: 'Overdue',
        penalty: penaltyAmount,
        balance: newBalance,
      };
    }
    return collection;
  }
  
  // Determine overall loan status from collection items
  function determineLoanStatus(collections) {
    if (!collections || collections.length === 0) return 'Active';
    const allPaid = collections.every(c => c.status === 'Paid');
    const anyOverdue = collections.some(c => c.status === 'Overdue');
  
    if (allPaid) return 'Closed';
    if (anyOverdue) return 'Overdue';
    return 'Active';
  }
  
  module.exports = { applyOverduePenalty, determineLoanStatus };