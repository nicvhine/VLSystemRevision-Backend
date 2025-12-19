const express = require('express');
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const router = express.Router();
const { decrypt } = require("../../utils/crypt");

module.exports = (db) => {
  const collections = db.collection('collections');

  // Get all collections (optionally filtered by collector)
  router.get(
    '/',
    authenticateToken,
    async (req, res) => {
      try {
        const { role, borrowersId, userId } = req.user;
        const collectorQuery = req.query.collector;
  
        let query = {};
  
        if (role === 'head' || role === 'manager') {
          query = collectorQuery ? { collector: collectorQuery } : {};
        } else if (role === 'collector') {
          query = { collectorId: userId };
        } else if (role === 'borrower') {
          query = { borrowersId };
        } else {
          return res.status(403).json({ error: 'Unauthorized role' });
        }
  
        let result = await collections.find(query).sort({ collectionNumber: 1 }).toArray();
  
        // Fetch loan balances for each collection
        const loansCollection = db.collection('loans');
        const resultWithBalance = await Promise.all(result.map(async (item) => {
          const loan = await loansCollection.findOne({ loanId: item.loanId });
          return {
            ...item,
            name: item.name ? decrypt(item.name) : item.name,
            loanBalance: loan?.balance ?? 0, // add loan balance
          };
        }));
  
        res.json(resultWithBalance);
      } catch (err) {
        console.error("Error loading collections:", err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );
  

  // Get payment schedule by borrower and loan
  router.get(
    '/schedule/:borrowersId/:loanId',
    authenticateToken,
    authorizeRole("manager", "head", "borrower", "collector"),
    async (req, res) => {
      try {
        const { role, borrowersId: jwtBorrowerId, name } = req.user;
        const { borrowersId, loanId } = req.params;

        // Role-based access check
        if (
          role === 'collector' && name !== req.query.collector ||
          role === 'borrower' && jwtBorrowerId !== borrowersId
        ) {
          return res.status(403).json({ error: 'Unauthorized access' });
        }

        const schedule = await collections.find({ borrowersId, loanId }).sort({ collectionNumber: 1 }).toArray();
        if (!schedule || schedule.length === 0) {
          return res.status(404).json({ error: 'No payment schedule found for this borrower and loan.' });
        }

        res.json(schedule);
      } catch (err) {
        console.error('Error fetching payment schedule:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  // GET collectors
  router.get(
    '/collectors',
    authenticateToken,
    authorizeRole('manager', 'head'), 
    async (req, res) => {
      try {
        const collectors = await db.collection('users').find({ role: 'collector' }).toArray();
        const names = collectors.map(c => c.name);
        res.json(names);
      } catch (err) {
        console.error('Failed to fetch collectors:', err);
        res.status(500).json({ error: 'Failed to load collectors' });
      }
    }
  );

  // Get loan by ID with collections (no overdue penalties)
  router.get(
    '/:loanId',
    authenticateToken,
    async (req, res) => {
      try {
        const { role, borrowersId, username } = req.user;
        const { loanId } = req.params;

        const loan = await db.collection('loans').findOne({ loanId });
        if (!loan) return res.status(404).json({ error: 'Loan not found' });

        // Restrict access for borrower / collector
        if (
          role === 'borrower' && loan.borrowersId !== borrowersId ||
          role === 'collector' && loan.collector !== username
        ) {
          return res.status(403).json({ error: 'Unauthorized access' });
        }

        const loanCollections = await collections.find({ loanId }).toArray();
        res.json({ ...loan, collections: loanCollections });
      } catch (err) {
        console.error('Error fetching loan:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
};
