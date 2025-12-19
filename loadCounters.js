const { getMaxNumericId } = require('./utils/database');

async function loadCounters(db) {
    const maxUserSeq = await getMaxNumericId(db, 'users', 'userId');
    const maxApplicationSeq = await getMaxNumericId(db, 'loan_applications', 'applicationId', false);
    const maxLoanSeq = await getMaxNumericId(db, 'loans', 'loanId', true);
    const maxBorrowersSeq = await getMaxNumericId(db, 'borrowers_account', 'borrowersId', true);

    const counters = db.collection('counters');
    await counters.updateOne({ _id: 'userId' }, { $set: { seq: maxUserSeq } }, { upsert: true });
    await counters.updateOne({ _id: 'applicationId' }, { $set: { seq: maxApplicationSeq } }, { upsert: true });
    await counters.updateOne({ _id: 'borrowersId' }, { $set: { seq: maxBorrowersSeq } }, { upsert: true });
    await counters.updateOne({ _id: 'loanId' }, { $set: { seq: maxLoanSeq } }, { upsert: true });

    console.log('Counters initialized:', {
        userId: maxUserSeq,
        applicationId: maxApplicationSeq,
        loanId: maxLoanSeq,
        borrowersId: maxBorrowersSeq
    });
}

module.exports = loadCounters;
