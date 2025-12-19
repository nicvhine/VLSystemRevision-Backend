const express = require('express');
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const router = express.Router();

module.exports = (db) => {

  // Save note
  router.put(
    '/:referenceNumber/note',
    authenticateToken,
    authorizeRole('collector'),
    async (req, res) => {
      const { referenceNumber } = req.params;
      const { note } = req.body;
      const { name } = req.user;

      if (typeof note !== 'string') {
        return res.status(400).json({ error: 'Note must be a string' });
      }

      try {
        const collection = await db.collection('collections').findOne({ referenceNumber });
        if (!collection) return res.status(404).json({ error: 'Collection not found' });
        if (collection.collector !== name) {
          return res.status(403).json({ error: 'You can only update notes on your own collections' });
        }

        const result = await db.collection('collections').findOneAndUpdate(
          { referenceNumber },
          { $set: { note } },
          { returnDocument: 'after' }
        );

        res.json(result);
      } catch (err) {
        console.error('Failed to update note:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );


  //  Compute penalty and paymentStatus based on dueDate
  router.put(
    '/:referenceNumber/penalty',
    authenticateToken,
    authorizeRole('manager', 'head'),
    async (req, res) => {
      const { referenceNumber } = req.params;
  
      try {
        const collection = await db.collection('collections').findOne({ referenceNumber });
        if (!collection) {
          return res.status(404).json({ error: 'Collection not found' });
        }
  
        const { dueDate, periodAmount, loanId, isPaid } = collection;
        if (!dueDate || !periodAmount) {
          return res.status(400).json({ error: 'Missing dueDate or periodAmount' });
        }
  
        const now = new Date();
        const due = new Date(dueDate);
        const daysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
  
        let penalty = 0;
        let creditScoreChange = 0;
  
        if (!isPaid) {
          if (daysLate > 30) {
            penalty = periodAmount * 0.05;
            creditScoreChange = -1.5;
          } else if (daysLate > 3) {
            penalty = periodAmount * 0.02;
            creditScoreChange = -0.5;
          }
        } else {
          if (daysLate > 3) creditScoreChange = -0.5;
          else creditScoreChange = +0.5;
        }
  
        await db.collection('collections').updateOne(
          { referenceNumber },
          { $set: { penalty, lastPenaltyUpdated: new Date() } }
        );
  
        if (loanId && creditScoreChange !== 0) {
          const loan = await db.collection('loans').findOne({ _id: loanId });
          if (loan) {
            let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
            if (newCreditScore > 10) newCreditScore = 10;
            if (newCreditScore < 0) newCreditScore = 0;
  
            await db.collection('loans').updateOne(
              { _id: loanId },
              { $set: { creditScore: newCreditScore } }
            );
          }
        }

        // Notify borrower if penalty was applied
        if (penalty > 0 && collection.borrowersId) {
          try {
            const notificationRepository = require("../../repositories/notificationRepository");
            const notifRepo = notificationRepository(db);
            await notifRepo.insertBorrowerNotifications([{
              borrowersId: collection.borrowersId,
              type: "late-payment-penalty",
              title: "Late Payment Penalty Notice",
              message: `A late payment penalty of ₱${penalty.toLocaleString()} has been assessed on your account for collection reference ${referenceNumber}, which is ${daysLate} day(s) overdue. Please settle your account to avoid additional charges.`,
              referenceNumber,
              amount: penalty,
              read: false,
              viewed: false,
              createdAt: new Date(),
            }]);
          } catch (notifErr) {
            console.error("Failed to notify borrower about penalty:", notifErr);
          }
        }
  
        res.json({
          message: 'Penalty and credit score updated successfully',
          penalty,
          creditScoreChange,
        });
      } catch (err) {
        console.error('Failed to update penalty:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );


  return router;
};
