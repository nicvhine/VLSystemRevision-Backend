function normalizeCollections(cashCollections, paymongoCollections) {
    const normalizedCash = cashCollections.map(c => ({
      ...c,
      mode: "Cash",
    }));
  
    const normalizedPaymongo = paymongoCollections.map(p => ({
      loanId: p.loanId || '',
      borrowersId: p.borrowersId,
      name: p.name || 'PayMongo Borrower',
      referenceNumber: p.referenceNumber,
      dueDate: p.createdAt || new Date(),
      periodAmount: p.amount,
      paidAmount: p.status === 'paid' ? p.amount : 0,
      totalPayment: p.amount,
      loanBalance: 0,
      status: p.status === 'paid' ? 'Paid' : 'Unpaid',
      collector: 'PayMongo',
      note: 'Paid via GCash',
      collectionNumber: p.collectionNumber || 0,
      mode: "GCash",
    }));
  
    return [...normalizedCash, ...normalizedPaymongo];
  }
  
  module.exports = { normalizeCollections };
  