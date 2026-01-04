
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
      // Skip if already paid
      if (collection.status === "Paid") continue;

      const dueDate = new Date(collection.dueDate);
      const daysLate = Math.floor((currentDate - dueDate) / (1000 * 60 * 60 * 24));

      // Only adjust for unpaid or partial collections
      if (collection.status === "Unpaid" || collection.status === "Partial") {
        if (daysLate > 0 && daysLate <= 7) {
          // 1-7 days overdue: -0.5
          creditDelta -= 0.5;
        } else if (daysLate > 7 && daysLate <= 30) {
          // 8-30 days overdue: -1
          creditDelta -= 1;
        } else if (daysLate > 30) {
          // More than 30 days overdue: -2
          creditDelta -= 2;
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
