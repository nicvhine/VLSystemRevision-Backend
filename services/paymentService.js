// services/paymentService.js
const paymentRepository = require("../repositories/paymentRepository");
const loanRepository = require("../repositories/loanRepository");
const { determineLoanStatus } = require("../utils/collection");
const { scheduleDueNotifications } = require("./borrowerNotif");
const axios = require("axios");
const { decrypt } = require("../utils/crypt");

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Helper to generate unique payment reference
const generatePaymentRef = (collectionRef) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `${collectionRef}-P-${timestamp}-${random}`;
};

/**
 * Generate next Open-Term interest-only collection.
 * Uses loan.balance (principal outstanding) to compute next interest.
 */
const generateNextOpenTermCollection = async (db, loan, lastCollection) => {
  const repo = loanRepository(db);
  const balance = Number(loan.balance);
  if (!balance || balance <= 0) return null;

  const interestRate = Number(loan.appInterestRate) || 0;
  const interestAmount = balance * (interestRate / 100);

  // Monthly due date: one month after last collection
  const dueDate = new Date(lastCollection.dueDate);
  dueDate.setMonth(dueDate.getMonth() + 1);

  const nextCollection = {
    referenceNumber: `${loan.loanId}-C${lastCollection.collectionNumber + 1}`,
    loanId: loan.loanId,
    borrowersId: loan.borrowersId,
    name: lastCollection.name,
    collectionNumber: lastCollection.collectionNumber + 1,
    dueDate,
    periodAmount: interestAmount,
    periodInterestRate: interestRate,
    periodInterestAmount: interestAmount,
    runningBalance: balance,
    paidAmount: 0,
    periodBalance: interestAmount,
    loanBalance: balance,
    status: "Unpaid",
    collector: lastCollection.collector,
    collectorId: lastCollection.collectorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await repo.insertCollections([nextCollection]);
  await scheduleDueNotifications(db, [nextCollection]);
  return nextCollection;
};


const applyPayment = async ({ referenceNumber, amount, collectorName, mode }, db) => {
  if (!amount || isNaN(amount) || amount <= 0) throw new Error("Invalid payment amount");

  const repo = paymentRepository(db);
  const now = new Date();

  // Fetch collection and previous status
  const collection = await repo.findCollection(referenceNumber);
  if (!collection) throw new Error("Collection not found");
  const prevStatus = collection.status;
  console.log("[DEBUG] Previous collection status:", prevStatus);

  // Fetch loan
  const loan = await repo.findLoan(collection.loanId);
  if (!loan) throw new Error("Loan not found");
  console.log("[DEBUG] Loan fetched:", loan.loanId, "Current creditScore:", loan.creditScore);

  const paymentLogs = [];
  let remainingAmount = amount;

  // --- OPEN-TERM LOAN ---
  if (loan.loanType === "Open-Term Loan") {
    const interestDue = Number(collection.periodBalance);
    const principalOutstanding = Number(loan.balance || collection.loanBalance || collection.runningBalance || 0);

    const interestPaid = Math.min(remainingAmount, interestDue);
    remainingAmount -= interestPaid;

    const principalPaid = Math.min(remainingAmount, principalOutstanding);
    remainingAmount -= principalPaid;

    const newPeriodBalance = Math.max(interestDue - interestPaid, 0);
    const newLoanBalanceSnapshot = Math.max(principalOutstanding - principalPaid, 0);

    collection.paidAmount = (collection.paidAmount || 0) + interestPaid + principalPaid;
    collection.periodBalance = newPeriodBalance;
    collection.loanBalance = newLoanBalanceSnapshot;
    collection.mode = mode;
    collection.paidAt = now;
    collection.status = newPeriodBalance <= 0 ? "Paid" : "Partial";

    console.log("[DEBUG] Open-Term collection updated:", collection);

    await repo.updateCollection(collection.referenceNumber, {
      paidAmount: collection.paidAmount,
      periodBalance: collection.periodBalance,
      loanBalance: collection.loanBalance,
      status: collection.status,
      mode: collection.mode,
      paidAt: collection.paidAt,
    });

    const log = {
      loanId: loan.loanId,
      referenceNumber: generatePaymentRef(collection.referenceNumber),
      borrowersId: collection.borrowersId,
      collector: collection.collector || "Cash Collector",
      amount,
      meta: { interestPaid, principalPaid },
      interestPaid,
      principalPaid,
      balance: newPeriodBalance + newLoanBalanceSnapshot,
      paidToCollection: collection.collectionNumber,
      mode,
      datePaid: now,
      createdAt: now,
    };
    paymentLogs.push(log);
    await repo.insertPayments([log]);

    await repo.incrementLoan(loan.loanId, { paidAmount: amount, balance: -principalPaid });

    if (collection.periodBalance <= 0 && newLoanBalanceSnapshot > 0) {
      const updatedLoan = await repo.findLoan(loan.loanId);
      await generateNextOpenTermCollection(db, updatedLoan, collection);
    }
  } else {
    // --- FIXED-TERM LOAN ---
    const loanCollections = await repo.findLoanCollections(collection.loanId);
    for (let col of loanCollections) {
      if (remainingAmount <= 0) break;

      const due = col.periodAmount || 0;
      const alreadyPaid = col.paidAmount || 0;
      const periodRemaining = Math.max(due - alreadyPaid, 0);
      if (periodRemaining <= 0) continue;

      const paymentToApply = Math.min(remainingAmount, periodRemaining);
      const newPaidAmount = alreadyPaid + paymentToApply;

      const prevColStatus = col.status;

      await repo.updateCollection(col.referenceNumber, {
        paidAmount: newPaidAmount,
        periodBalance: Math.max(due - newPaidAmount, 0),
        status: newPaidAmount >= due ? "Paid" : "Partial",
        loanBalance: Math.max((col.loanBalance || col.periodAmount) - paymentToApply, 0),
        mode,
        paidAt: now,
      });

      console.log("[DEBUG] Fixed-Term collection updated:", col.referenceNumber, "PrevStatus:", prevColStatus, "NewStatus:", newPaidAmount >= due ? "Paid" : "Partial");

      paymentLogs.push({
        loanId: col.loanId,
        referenceNumber: generatePaymentRef(col.referenceNumber),
        borrowersId: col.borrowersId,
        collector: col.collector,
        amount: paymentToApply,
        balance: Math.max(due - newPaidAmount, 0),
        paidToCollection: col.collectionNumber,
        mode,
        datePaid: now,
        prevStatus: prevColStatus,
        createdAt: now,
      });

      remainingAmount -= paymentToApply;
    }

    const totalApplied = amount - remainingAmount;
    await repo.incrementLoan(collection.loanId, { paidAmount: totalApplied, balance: -totalApplied });
    if (paymentLogs.length > 0) await repo.insertPayments(paymentLogs);
  }

  // --- UPDATE LOAN STATUS ---
  const updatedLoanCollections = await repo.findLoanCollections(collection.loanId);
  const loanStatus = determineLoanStatus(updatedLoanCollections);
  await repo.updateLoan(collection.loanId, { status: loanStatus });

  // --- ADJUST CREDIT SCORE BASED ON PREVIOUS STATUS ---
  if (loan.loanId) {
    let delta = 0;
    console.log("[DEBUG] Previous collection status for creditScore adjustment:", prevStatus);

    switch (prevStatus) {
      case "Unpaid":
        delta = 0.5;
        break;
      case "Past Due":
        delta = -0.5;
        break;
      case "Overdue":
        delta = -1.5;
        break;
      default:
        delta = 0;
    }

    console.log("[DEBUG] Credit score delta calculated:", delta);

    if (delta !== 0) {
      const currentLoan = await db.collection("loans").findOne({ loanId: loan.loanId });
      console.log("[DEBUG] Current loan creditScore before update:", currentLoan.creditScore);

      const newCreditScore = Math.min(Math.max((currentLoan.creditScore || 0) + delta, 0), 10);

      console.log("[DEBUG] New creditScore to set:", newCreditScore);

      await db.collection("loans").updateOne(
        { loanId: loan.loanId },
        { $set: { creditScore: newCreditScore } }
      );
    }
  }


  // Fetch updated collection to return
  const updatedCollection = await repo.findCollection(referenceNumber);

  return {
    message: `${mode} payment applied successfully`,
    borrowersId: collection.borrowersId,
    amount,
    referenceNumber,
    paymentLogs,
    remainingUnapplied: remainingAmount,
    ...updatedCollection, // Include all updated collection fields
  };
};


// Cash payment
const handleCashPayment = async (payload, db) => applyPayment({ ...payload, mode: "Cash" }, db);

// Handle PayMongo success callback
const handlePaymongoSuccess = async (referenceNumber, db) => {
  const repo = paymentRepository(db);
  const paymongoPayment = await repo.findPaymongoPayment(referenceNumber);
  if (!paymongoPayment) throw new Error("PayMongo payment not found");

  const now = new Date();
  await repo.updatePaymongoPayment(referenceNumber, { status: "success", paidAt: now });

  // Apply payment to collections/loan
  const result = await applyPayment({
    referenceNumber,
    amount: paymongoPayment.amount,
    mode: "Paymongo",
  }, db);

  // Notify assigned collector if present
  const borrower = await db.collection("borrowers_account").findOne(
    { borrowersId: paymongoPayment.borrowersId },
    { projection: { assignedCollectorId: 1, name: 1 } }
  );

  if (borrower?.assignedCollectorId) {
    const decryptedName = borrower.name ? decrypt(borrower.name) : "Unknown";
    const notifRepo = require("../repositories/notificationRepository")(db);

    await notifRepo.insertCollectorNotification({
      type: "paymongo-payment-received",
      title: "PayMongo Payment Received",
      message: `Payment of ${paymongoPayment.amount} via PayMongo for collection ${referenceNumber} has been received from ${decryptedName}.`,
      referenceNumber,
      actor: decryptedName,
      collectorId: borrower.assignedCollectorId,
      read: false,
      viewed: false,
      createdAt: now,
    });
  }

  return result;
};

// Create PayMongo GCash intent
const createPaymongoGcash = async ({ amount, collectionNumber, referenceNumber, borrowersId }, db) => {
  if (!referenceNumber || !borrowersId || !amount || amount <= 0)
    throw new Error("Invalid request payload");

  const paymentIntentRes = await axios.post(
    "https://api.paymongo.com/v1/payment_intents",
    {
      data: {
        attributes: {
          amount: Math.round(amount * 100),
          currency: "PHP",
          payment_method_allowed: ["gcash"],
          description: `Payment for collection ${collectionNumber}`,
          metadata: { referenceNumber, borrowersId },
        },
      },
    },
    { auth: { username: PAYMONGO_SECRET_KEY, password: "" } }
  );

  const paymentIntent = paymentIntentRes.data.data;

  const sourceRes = await axios.post(
    "https://api.paymongo.com/v1/sources",
    {
      data: {
        attributes: {
          type: "gcash",
          amount: Math.round(amount * 100),
          currency: "PHP",
          redirect: {
            // success: `${FRONTEND_URL}/userPage/borrowerPage/payMongoTools/payment-success/${referenceNumber}`,
            // failed: `${FRONTEND_URL}/borrower/payment-failed/${referenceNumber}`,
            success: `http://localhost:3000/userPage/borrowerPage/payMongoTools/payment-success/${referenceNumber}`,
            failed: `http://localhost:3000/borrower/payment-failed/${referenceNumber}`,
          },
          payment_intent: paymentIntent.id,
          statement_descriptor: `Collection ${collectionNumber}`,
          metadata: { referenceNumber, borrowersId },
        },
      },
    },
    { auth: { username: PAYMONGO_SECRET_KEY, password: "" } }
  );

  const checkoutUrl = sourceRes.data.data.attributes.redirect.checkout_url;

  await db.collection("paymongo-payments").insertOne({
    referenceNumber,
    collectionNumber,
    borrowersId,
    amount,
    paymentIntentId: paymentIntent.id,
    sourceId: sourceRes.data.data.id,
    status: "pending",
    createdAt: new Date(),
  });

  return { checkout_url: checkoutUrl };
};

// Other helpers (getLoanLedger, getBorrowerPayments, etc.) remain unchanged
const getLoanLedger = async (loanId, db) => {
  const repo = paymentRepository(db);
  const payments = await repo.getPaymentsByLoan(loanId);
  return payments.map((p) => ({
    referenceNumber: p.referenceNumber,
    amount: p.amount || 0,
    datePaid: p.datePaid || null,
    mode: p.mode || "Cash",
    loanId: p.loanId,
    borrowersId: p.borrowersId,
    paidToCollection: p.paidToCollection,
  }));
};

const getBorrowerPayments = async (borrowersId, db) => {
  const repo = paymentRepository(db);
  const payments = await repo.getPaymentsByBorrower(borrowersId);
  return payments.map((p) => ({
    referenceNumber: p.referenceNumber,
    amount: p.amount || 0,
    datePaid: p.datePaid || null,
    mode: p.mode || "Cash",
    loanId: p.loanId,
    borrowersId: p.borrowersId,
    paidToCollection: p.paidToCollection,
  }));
};

const getPaymentsByBorrowers = async (borrowerIds, db) => {
  if (!Array.isArray(borrowerIds) || borrowerIds.length === 0) return [];

  const repo = paymentRepository(db);
  const payments = await repo.getPaymongoPaymentsByBorrowers(borrowerIds);

  return payments.map((p) => ({
    referenceNumber: p.referenceNumber,
    amount: p.amount || 0,
    datePaid: p.datePaid || null,
    mode: p.mode,
    loanId: p.loanId,
    borrowersId: p.borrowersId,
    paidToCollection: p.paidToCollection,
  }));
};

const getPaymongoPaymentsWithNames = async (borrowerIds, db) => {
  if (!Array.isArray(borrowerIds) || borrowerIds.length === 0) return [];

  const payments = await db
    .collection("payments")
    .find({ borrowersId: { $in: borrowerIds }, mode: "Paymongo" })
    .sort({ createdAt: -1 })
    .toArray();

  const borrowers = await db
    .collection("borrowers_account")
    .find({ borrowersId: { $in: borrowerIds } })
    .project({ borrowersId: 1, name: 1 })
    .toArray();

  const borrowerMap = borrowers.reduce((acc, b) => {
    acc[b.borrowersId] = b.name;
    return acc;
  }, {});

  return payments.map((p) => ({
    ...p,
    name: borrowerMap[p.borrowersId] ? decrypt(borrowerMap[p.borrowersId]) : "Unknown",
  }));
};

module.exports = {
  handleCashPayment,
  createPaymongoGcash,
  handlePaymongoSuccess,
  getBorrowerPayments,
  getLoanLedger,
  getPaymentsByBorrowers,
  getPaymongoPaymentsWithNames,
  generateNextOpenTermCollection,
};
