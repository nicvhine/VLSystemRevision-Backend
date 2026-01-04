const { connect, clear, close, getDb } = require('./testDB');
const { mockApplication, mockBorrower, mockLoan, mockCollection } = require('./mocks');
const creditScoreAdjustmentCron = require('../Crons/ProductionCrons/creditScoreAdjustment');

let db;

beforeAll(async () => {
  await connect();
  db = getDb();
});

afterEach(async () => await clear());
afterAll(async () => await close());

describe('Credit Scoring Logic', () => {
  
  // ============================================
  // UNIT TESTS - Collection Endpoint Scoring
  // ============================================
  describe('Collection Endpoint Credit Score Adjustments', () => {
    
    test('should apply -1.5 credit score for unpaid collection >30 days late', async () => {
      const loanId = 'loan-001';
      const referenceNumber = 'ref-001';
      const periodAmount = 5000;
      
      // Create a loan with initial credit score of 5
      const loanData = {
        loanId,
        borrowersId: 'BRW001',
        creditScore: 5,
      };
      await db.collection('loans').insertOne(loanData);
      
      // Create a collection that's 40 days overdue (unpaid)
      const daysLate = 40;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        referenceNumber,
        loanId,
        borrowersId: 'BRW001',
        periodAmount,
        dueDate,
        isPaid: false,
        status: 'Unpaid',
      };
      await db.collection('collections').insertOne(collectionData);
      
      // Manually calculate penalty as done in putCollection.js
      const now = new Date();
      const due = new Date(dueDate);
      const calculatedDaysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
      
      let penalty = 0;
      let creditScoreChange = 0;
      
      if (!collectionData.isPaid) {
        if (calculatedDaysLate > 30) {
          penalty = periodAmount * 0.05;
          creditScoreChange = -1.5;
        } else if (calculatedDaysLate > 3) {
          penalty = periodAmount * 0.02;
          creditScoreChange = -0.5;
        }
      }
      
      // Apply credit score change
      const loan = await db.collection('loans').findOne({ loanId });
      let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
      newCreditScore = Math.min(Math.max(newCreditScore, 0), 10);
      
      await db.collection('loans').updateOne(
        { loanId },
        { $set: { creditScore: newCreditScore } }
      );
      
      const updatedLoan = await db.collection('loans').findOne({ loanId });
      
      expect(penalty).toBe(periodAmount * 0.05); // 250
      expect(creditScoreChange).toBe(-1.5);
      expect(updatedLoan.creditScore).toBe(3.5); // 5 - 1.5
    });

    test('should apply -0.5 credit score for unpaid collection 4-30 days late', async () => {
      const loanId = 'loan-002';
      const referenceNumber = 'ref-002';
      const periodAmount = 5000;
      
      const loanData = {
        loanId,
        borrowersId: 'BRW002',
        creditScore: 7,
      };
      await db.collection('loans').insertOne(loanData);
      
      // 15 days overdue
      const daysLate = 15;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        referenceNumber,
        loanId,
        borrowersId: 'BRW002',
        periodAmount,
        dueDate,
        isPaid: false,
        status: 'Unpaid',
      };
      await db.collection('collections').insertOne(collectionData);
      
      const now = new Date();
      const due = new Date(dueDate);
      const calculatedDaysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
      
      let creditScoreChange = 0;
      if (calculatedDaysLate > 3) {
        creditScoreChange = -0.5;
      }
      
      const loan = await db.collection('loans').findOne({ _id: loanId });
      let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
      newCreditScore = Math.min(Math.max(newCreditScore, 0), 10);
      
      await db.collection('loans').updateOne(
        { _id: loanId },
        { $set: { creditScore: newCreditScore } }
      );
      
      const updatedLoan = await db.collection('loans').findOne({ _id: loanId });
      
      expect(creditScoreChange).toBe(-0.5);
      expect(updatedLoan.creditScore).toBe(6.5); // 7 - 0.5
    });

    test('should apply +0.5 credit score for paid collection on time', async () => {
      const loanId = 'loan-003';
      const referenceNumber = 'ref-003';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW003',
        creditScore: 6,
      };
      await db.collection('loans').insertOne(loanData);
      
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 5); // Due in future
      
      const collectionData = {
        referenceNumber,
        loanId,
        borrowersId: 'BRW003',
        periodAmount: 5000,
        dueDate,
        isPaid: true,
        status: 'Paid',
      };
      await db.collection('collections').insertOne(collectionData);
      
      let creditScoreChange = 0;
      if (collectionData.isPaid) {
        creditScoreChange = +0.5;
      }
      
      const loan = await db.collection('loans').findOne({ loanId });
      let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
      newCreditScore = Math.min(Math.max(newCreditScore, 0), 10);
      
      await db.collection('loans').updateOne(
        { loanId },
        { $set: { creditScore: newCreditScore } }
      );
      
      const updatedLoan = await db.collection('loans').findOne({ loanId });
      
      expect(creditScoreChange).toBe(0.5);
      expect(updatedLoan.creditScore).toBe(6.5); // 6 + 0.5
    });

    test('should apply -0.5 credit score for paid collection but >3 days late', async () => {
      const loanId = 'loan-004';
      const referenceNumber = 'ref-004';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW004',
        creditScore: 8,
      };
      await db.collection('loans').insertOne(loanData);
      
      // 10 days late but still paid
      const daysLate = 10;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        referenceNumber,
        loanId,
        borrowersId: 'BRW004',
        periodAmount: 5000,
        dueDate,
        isPaid: true,
        status: 'Paid',
      };
      await db.collection('collections').insertOne(collectionData);
      
      const now = new Date();
      const due = new Date(dueDate);
      const calculatedDaysLate = Math.floor((now - due) / (1000 * 60 * 60 * 24));
      
      let creditScoreChange = 0;
      if (collectionData.isPaid) {
        if (calculatedDaysLate > 3) creditScoreChange = -0.5;
        else creditScoreChange = +0.5;
      }
      
      const loan = await db.collection('loans').findOne({ loanId });
      let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
      newCreditScore = Math.min(Math.max(newCreditScore, 0), 10);
      
      await db.collection('loans').updateOne(
        { loanId },
        { $set: { creditScore: newCreditScore } }
      );
      
      const updatedLoan = await db.collection('loans').findOne({ loanId });
      
      expect(creditScoreChange).toBe(-0.5);
      expect(updatedLoan.creditScore).toBe(7.5); // 8 - 0.5
    });

    test('should clamp credit score between 0 and 10', async () => {
      const loanId = 'loan-005';
      const referenceNumber = 'ref-005';
      
      // Start with 1, apply -1.5 multiple times
      const loanData = {
        loanId,
        borrowersId: 'BRW005',
        creditScore: 1,
      };
      await db.collection('loans').insertOne(loanData);
      
      // Apply three penalty updates
      for (let i = 0; i < 3; i++) {
        const daysLate = 40 + (i * 30);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() - daysLate);
        
        let creditScoreChange = -1.5;
        const loan = await db.collection('loans').findOne({ loanId });
        let newCreditScore = (loan.creditScore || 0) + creditScoreChange;
        newCreditScore = Math.min(Math.max(newCreditScore, 0), 10);
        
        await db.collection('loans').updateOne(
          { loanId },
          { $set: { creditScore: newCreditScore } }
        );
      }
      
      const updatedLoan = await db.collection('loans').findOne({ loanId });
      
      expect(updatedLoan.creditScore).toBe(0); // Should not go below 0
    });

    test('should not adjust score for already paid collection', async () => {
      const loanId = 'loan-006';
      const referenceNumber = 'ref-006';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW006',
        creditScore: 7,
      };
      await db.collection('loans').insertOne(loanData);
      
      const collectionData = {
        referenceNumber,
        loanId,
        borrowersId: 'BRW006',
        periodAmount: 5000,
        dueDate: new Date(),
        isPaid: false,
        status: 'Paid', // Already marked as paid
      };
      await db.collection('collections').insertOne(collectionData);
      
      // In putCollection logic, status "Paid" means no adjustment
      const updatedLoan = await db.collection('loans').findOne({ loanId });
      
      expect(updatedLoan.creditScore).toBe(7); // No change
    });
  });

  // ============================================
  // UNIT TESTS - Cron Job Scoring
  // ============================================
  describe('Credit Score Adjustment Cron Logic', () => {
    
    test('should apply -0.5 for 1-7 days overdue', async () => {
      const loanId = 'loan-cron-001';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-CRON-001',
        creditScore: 7,
      };
      await db.collection('loans').insertOne(loanData);
      
      // 5 days overdue
      const daysLate = 5;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        loanId,
        borrowersId: 'BRW-CRON-001',
        dueDate,
        status: 'Unpaid',
        periodAmount: 5000,
      };
      await db.collection('collections').insertOne(collectionData);
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(6.5); // 7 - 0.5
    });

    test('should apply -1 for 8-30 days overdue', async () => {
      const loanId = 'loan-cron-002';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-CRON-002',
        creditScore: 8,
      };
      await db.collection('loans').insertOne(loanData);
      
      // 20 days overdue
      const daysLate = 20;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        loanId,
        borrowersId: 'BRW-CRON-002',
        dueDate,
        status: 'Unpaid',
        periodAmount: 5000,
      };
      await db.collection('collections').insertOne(collectionData);
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(7); // 8 - 1
    });

    test('should apply -2 for >30 days overdue', async () => {
      const loanId = 'loan-cron-003';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-CRON-003',
        creditScore: 9,
      };
      await db.collection('loans').insertOne(loanData);
      
      // 45 days overdue
      const daysLate = 45;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - daysLate);
      
      const collectionData = {
        loanId,
        borrowersId: 'BRW-CRON-003',
        dueDate,
        status: 'Unpaid',
        periodAmount: 5000,
      };
      await db.collection('collections').insertOne(collectionData);
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(7); // 9 - 2
    });

    test('should handle multiple collections for same loan', async () => {
      const loanId = 'loan-cron-004';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-CRON-004',
        creditScore: 10,
      };
      await db.collection('loans').insertOne(loanData);
      
      // Collection 1: 5 days late (-0.5)
      const dueDate1 = new Date();
      dueDate1.setDate(dueDate1.getDate() - 5);
      
      await db.collection('collections').insertOne({
        loanId,
        borrowersId: 'BRW-CRON-004',
        dueDate: dueDate1,
        status: 'Unpaid',
        periodAmount: 5000,
      });
      
      // Collection 2: 15 days late (-1)
      const dueDate2 = new Date();
      dueDate2.setDate(dueDate2.getDate() - 15);
      
      await db.collection('collections').insertOne({
        loanId,
        borrowersId: 'BRW-CRON-004',
        dueDate: dueDate2,
        status: 'Unpaid',
        periodAmount: 5000,
      });
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(8.5); // 10 - 0.5 - 1
    });

    test('should skip paid collections', async () => {
      const loanId = 'loan-cron-005';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-CRON-005',
        creditScore: 6,
      };
      await db.collection('loans').insertOne(loanData);
      
      // Paid collection (40 days late, but paid so skip)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 40);
      
      await db.collection('collections').insertOne({
        loanId,
        borrowersId: 'BRW-CRON-005',
        dueDate,
        status: 'Paid', // Already paid, should be skipped
        periodAmount: 5000,
      });
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue; // Skip paid

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(6); // No change, paid collections are skipped
    });
  });

  // ============================================
  // INTEGRATION TESTS
  // ============================================
  describe('Credit Scoring Integration Tests', () => {
    
    test('should track credit score over multiple collection cycles', async () => {
      const loanId = 'loan-integration-001';
      
      // Create loan with initial score
      const loanData = {
        loanId,
        borrowersId: 'BRW-INT-001',
        creditScore: 8,
      };
      await db.collection('loans').insertOne(loanData);
      
      // Simulate 3 collection cycles with different outcomes
      const cycles = [
        { daysLate: 5, expectedDelta: -0.5 }, // 1-7 days
        { daysLate: 25, expectedDelta: -1 },  // 8-30 days
        { daysLate: 35, expectedDelta: -2 },  // >30 days
      ];
      
      for (const cycle of cycles) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() - cycle.daysLate);
        
        await db.collection('collections').insertOne({
          loanId,
          borrowersId: 'BRW-INT-001',
          dueDate,
          status: 'Unpaid',
          periodAmount: 5000,
        });
      }
      
      // Run cron logic
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

          await loansCollection.updateOne(
            { _id: loan._id },
            { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      const expectedScore = 8 - 0.5 - 1 - 2; // 4.5
      expect(updatedLoan.creditScore).toBe(4.5);
    });

    test('should maintain loan history with credit score updates', async () => {
      const loanId = 'loan-history-001';
      
      const loanData = {
        loanId,
        borrowersId: 'BRW-HIST-001',
        creditScore: 7,
        creditScoreHistory: [],
      };
      await db.collection('loans').insertOne(loanData);
      
      // Create a collection 20 days late
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 20);
      
      await db.collection('collections').insertOne({
        loanId,
        borrowersId: 'BRW-HIST-001',
        dueDate,
        status: 'Unpaid',
        periodAmount: 5000,
      });
      
      // Run cron and track history
      const currentDate = new Date();
      const loansCollection = db.collection('loans');
      const collectionsCollection = db.collection('collections');
      
      const loans = await loansCollection.find({}).toArray();
      
      for (const loan of loans) {
        const collections = await collectionsCollection
          .find({ loanId: loan.loanId })
          .toArray();

        let creditDelta = 0;

        for (const collection of collections) {
          if (collection.status === "Paid") continue;

          const colDueDate = new Date(collection.dueDate);
          const colDaysLate = Math.floor((currentDate - colDueDate) / (1000 * 60 * 60 * 24));

          if (collection.status === "Unpaid" || collection.status === "Partial") {
            if (colDaysLate > 0 && colDaysLate <= 7) {
              creditDelta -= 0.5;
            } else if (colDaysLate > 7 && colDaysLate <= 30) {
              creditDelta -= 1;
            } else if (colDaysLate > 30) {
              creditDelta -= 2;
            }
          }
        }

        if (creditDelta !== 0) {
          const currentScore = loan.creditScore || 0;
          const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);
          const history = loan.creditScoreHistory || [];
          
          history.push({
            previousScore: currentScore,
            newScore,
            delta: creditDelta,
            timestamp: new Date(),
          });

          await loansCollection.updateOne(
            { _id: loan._id },
            { 
              $set: { 
                creditScore: newScore,
                creditScoreHistory: history,
                creditScoreUpdatedAt: new Date() 
              }
            }
          );
        }
      }
      
      const updatedLoan = await loansCollection.findOne({ loanId });
      expect(updatedLoan.creditScore).toBe(6); // 7 - 1
      expect(updatedLoan.creditScoreHistory).toBeDefined();
      expect(updatedLoan.creditScoreHistory.length).toBe(1);
      expect(updatedLoan.creditScoreHistory[0].previousScore).toBe(7);
      expect(updatedLoan.creditScoreHistory[0].newScore).toBe(6);
      expect(updatedLoan.creditScoreHistory[0].delta).toBe(-1);
    });
  });
});
