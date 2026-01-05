
const cron = require("node-cron");

const creditScoreAdjustmentCron = (db) => {
  // Run every day at 2 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[CRON] Starting credit score adjustment job...");
    try {
      await adjustCreditScores(db);
      console.log("[CRON] Credit score adjustment completed successfully");
    } catch (error) {
      console.error("[CRON] Error in credit score adjustment:", error);
    }
  });
};

const adjustCreditScores = async (db) => {
  const currentDate = new Date();
  const loansCollection = db.collection("loans");
  const collectionsCollection = db.collection("collections");

  // Get all loans
  const loans = await loansCollection.find({}).toArray();

  for (const loan of loans) {
    // Get all collections for this loan
    const collections = await collectionsCollection
      .find({ loanId: loan.loanId })
      .toArray();

    let creditDelta = 0;

    for (const collection of collections) {
      const dueDate = new Date(collection.dueDate);
      const daysLate = Math.floor((currentDate - dueDate) / (1000 * 60 * 60 * 24));

      // Grace period: 3 days (no penalty)
      const GRACE_PERIOD = 3;
      // Past due threshold: up to 30 days
      const PAST_DUE_THRESHOLD = 30;

      if (collection.status === "Paid") {
        // On time payment: +0.5 points
        if (daysLate <= GRACE_PERIOD) {
          creditDelta += 0.5;
        }
      } else if (collection.status === "Unpaid" || collection.status === "Partial") {
        if (daysLate <= GRACE_PERIOD) {
          // Within grace period: no penalty
          continue;
        } else if (daysLate > GRACE_PERIOD && daysLate <= PAST_DUE_THRESHOLD) {
          // Past due (4-30 days): -0.5
          creditDelta -= 0.5;
        } else if (daysLate > PAST_DUE_THRESHOLD) {
          // Overdue (30+ days): -1.0
          creditDelta -= 1;
        }
      }
    }

    // Apply credit score adjustment if any
    if (creditDelta !== 0) {
      const currentScore = loan.creditScore || 0;
      const newScore = Math.min(Math.max(currentScore + creditDelta, 0), 10);

      console.log(
        `[CRON] Adjusting credit score for loan ${loan.loanId}: ${currentScore} -> ${newScore} (delta: ${creditDelta})`
      );

      await loansCollection.updateOne(
        { loanId: loan.loanId },
        { $set: { creditScore: newScore, creditScoreUpdatedAt: new Date() } }
      );
    }
  }
};

module.exports = creditScoreAdjustmentCron;
