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


const DEBUG = process.env.DEBUG_PAYMENT === 'true'; // Enable with DEBUG_PAYMENT=true

const applyPayment = async ({ referenceNumber, amount, collectorName, mode }, db) => {
  if (!amount || isNaN(amount) || amount <= 0) throw new Error("Invalid payment amount");

  const repo = paymentRepository(db);
  const now = new Date();

  console.log(`\n[PAYMENT_START] Processing payment of ₱${amount} for collection ${referenceNumber}, mode: ${mode}`);
  if (DEBUG) console.log(`[DEBUG_ENABLED] Full debugging active for this transaction`);

  // Fetch collection and previous status
  let collection = await repo.findCollection(referenceNumber);
  if (!collection) throw new Error("Collection not found");
  
  console.log(`[COLLECTION_BEFORE] referenceNumber: ${collection.referenceNumber}, status: ${collection.status}, paidAmount: ${collection.paidAmount}, periodAmount: ${collection.periodAmount}`);

  // Check if this collection was transferred to a new loan (due to reloan)
  if (collection.status === "Transferred") {
    console.log(`[TRANSFERRED_COLLECTION] Collection ${referenceNumber} has been transferred (reloan). Redirecting payment to new loan.`);
    
    // Find the new loan that this old loan was restructured into
    const oldLoan = await repo.findLoan(collection.loanId);
    const newLoan = await db.collection("loans").findOne({ 
      restructuredFromLoanId: collection.loanId,
      status: "Active" 
    });

    if (!newLoan) {
      throw new Error("This collection has been transferred due to reloan, but the new loan could not be found. Please contact support.");
    }

    console.log(`[TRANSFERRED_REDIRECT] Old loan: ${collection.loanId}, New loan: ${newLoan.loanId}. Applying ₱${amount} to new loan's balance.`);

    // Apply payment directly to new loan's remaining balance
    const newLoanCollections = await repo.findLoanCollections(newLoan.loanId);
    if (newLoanCollections.length === 0) {
      throw new Error("New loan has no collections. Please contact support.");
    }

    // Apply to the first unpaid collection of the new loan
    const unpaidCollections = newLoanCollections.filter(c => c.status === "Unpaid" || c.status === "Partial");
    if (unpaidCollections.length === 0) {
      throw new Error("New loan has no unpaid collections.");
    }

    // Redirect to first unpaid collection of new loan
    const redirectedReferenceNumber = unpaidCollections[0].referenceNumber;
    console.log(`[TRANSFERRED_REDIRECT_TARGET] Redirecting to collection ${redirectedReferenceNumber}`);

    // Log the transfer redirection
    const transferLog = {
      loanId: collection.loanId,
      referenceNumber: `TRANSFER-${referenceNumber}-${now.getTime()}`,
      borrowersId: collection.borrowersId,
      amount,
      mode,
      originalCollection: referenceNumber,
      redirectedToCollection: redirectedReferenceNumber,
      redirectedToLoan: newLoan.loanId,
      reason: "Reloan - Payment transferred to new loan",
      datePaid: now,
      createdAt: now,
    };
    
    await db.collection("payment-logs").insertOne(transferLog);
    console.log(`[TRANSFER_LOG_CREATED] Logged transfer of payment from ${referenceNumber} to ${redirectedReferenceNumber}`);

    // Recursively apply payment to the new collection
    return await applyPayment({ referenceNumber: redirectedReferenceNumber, amount, collectorName, mode }, db);
  }

  // Check if payment already fully applied to prevent double-charging
  // BUT: Allow payments if the collection was paid and now user wants to pay towards next installment
  if (collection.status === "Paid") {
    console.log(`[PAID_COLLECTION] Collection ${referenceNumber} is marked as Paid. Attempting to cascade payment to next collection.`);
    
    // Get all collections for this loan
    const allCollections = await repo.findLoanCollections(collection.loanId);
    const currentIndex = allCollections.findIndex(c => c.referenceNumber === referenceNumber);
    
    if (currentIndex >= 0 && currentIndex + 1 < allCollections.length) {
      // There's a next collection, redirect payment there
      const nextCollection = allCollections[currentIndex + 1];
      console.log(`[PAID_REDIRECT] Redirecting payment to next collection: ${nextCollection.referenceNumber}`);
      
      // Log the redirection
      const redirectLog = {
        originalCollection: referenceNumber,
        redirectedToCollection: nextCollection.referenceNumber,
        reason: "Original collection already fully paid, cascading to next",
        amount,
        mode,
        datePaid: now,
        createdAt: now,
      };
      
      // Recursively apply to the next collection instead
      return await applyPayment({ referenceNumber: nextCollection.referenceNumber, amount, collectorName, mode }, db);
    } else {
      // No next collection exists - this is an overpayment
      console.warn(`[OVERPAYMENT] Collection ${referenceNumber} is fully paid and is the last collection. Cannot apply overpayment.`);
      throw new Error("This collection has already been fully paid and there are no additional collections to apply this payment to");
    }
  }

  // Check for duplicate payment records - if this collection was just paid by looking at recent payment logs
  const recentPayments = await db.collection("payment-logs").find({
    referenceNumber: { $regex: `^${collection.referenceNumber}` }
  }).sort({ createdAt: -1 }).limit(5).toArray();
  
  console.log(`[RECENT_PAYMENTS] Found ${recentPayments.length} recent payments for collection ${collection.referenceNumber}`);
  
  if (recentPayments.length > 0) {
    const lastPayment = recentPayments[0];
    const timeSinceLastPayment = now.getTime() - new Date(lastPayment.createdAt).getTime();
    const totalRecentAmount = recentPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    console.log(`[DUPLICATE_CHECK] Time since last: ${timeSinceLastPayment}ms, Recent total amount: ₱${totalRecentAmount}, Current: ₱${amount}`);
    
    // If recent payments total close to the amount being applied (within 10%), it's likely a duplicate
    if (timeSinceLastPayment < 10000 && Math.abs(totalRecentAmount - amount) < (amount * 0.1)) {
      console.warn(`[WARNING] Duplicate payment detected for ${referenceNumber}. Recent payments total: ${totalRecentAmount}, Current amount: ${amount}. Skipping.`);
      throw new Error("Duplicate payment detected. This collection may have already been paid by this transaction.");
    }
  }

  const prevStatus = collection.status;
  console.log("[DEBUG] Previous collection status:", prevStatus, "Amount to apply:", amount);

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
      amount: interestPaid + principalPaid,
      meta: { interestPaid, principalPaid },
      interestPaid,
      principalPaid,
      balance: newPeriodBalance + newLoanBalanceSnapshot,
      paidToCollection: collection.collectionNumber,
      mode,
      datePaid: now,
      createdAt: now,
    };

    console.log(`[PAYMENT_LOG_OPEN_TERM] Created payment log with amount: ₱${log.amount}, interestPaid: ₱${interestPaid}, principalPaid: ₱${principalPaid}`);

    paymentLogs.push(log);
    await repo.insertPayments([log]);

    console.log(`[LOAN_INCREMENT] Incrementing loan ${loan.loanId} with paidAmount: ₱${interestPaid + principalPaid}, balance decrement: ₱${principalPaid}`);
    await repo.incrementLoan(loan.loanId, { paidAmount: interestPaid + principalPaid, balance: -principalPaid });

    if (collection.periodBalance <= 0 && newLoanBalanceSnapshot > 0) {
      const updatedLoan = await repo.findLoan(loan.loanId);
      await generateNextOpenTermCollection(db, updatedLoan, collection);
    }
  } else {
    // --- FIXED-TERM LOAN WITH CASCADING ---
    console.log(`[FIXED_TERM_START] Processing fixed-term loan for collection ${referenceNumber}, cascading enabled`);
    
    let currentCollection = collection;
    let collectionIndex = await repo.findLoanCollections(collection.loanId).then(cols => 
      cols.findIndex(c => c.referenceNumber === collection.referenceNumber)
    );
    
    // Get all collections for this loan
    const allCollections = await repo.findLoanCollections(collection.loanId);
    
    console.log(`[FIXED_TERM_COLLECTIONS] Found ${allCollections.length} collections, starting at index ${collectionIndex}`);
    
    let totalApplied = 0;
    
    // Process collections in order, cascading if needed
    while (remainingAmount > 0 && collectionIndex < allCollections.length) {
      currentCollection = allCollections[collectionIndex];
      
      console.log(`[CASCADING_PAYMENT] Processing collection ${collectionIndex}: ${currentCollection.referenceNumber}`);
      
      const due = Number(currentCollection.periodAmount || 0);
      const alreadyPaid = Number(currentCollection.paidAmount || 0);
      const periodRemaining = Math.max(due - alreadyPaid, 0);
      
      console.log(`[COLLECTION_DETAILS] Due: ₱${due}, Already Paid: ₱${alreadyPaid}, Remaining: ₱${periodRemaining}`);
      
      // If this collection is already paid, skip to next
      if (periodRemaining <= 0) {
        console.log(`[COLLECTION_SKIP] Collection already paid, moving to next`);
        collectionIndex++;
        continue;
      }
      
      // Apply payment to this collection
      const paymentToApply = Math.min(remainingAmount, periodRemaining);
      const newPaidAmount = alreadyPaid + paymentToApply;
      const newPeriodBalance = Math.max(due - newPaidAmount, 0);
      const prevColStatus = currentCollection.status;
      
      console.log(`[PAYMENT_APPLYING] Applying ₱${paymentToApply} to collection ${currentCollection.collectionNumber}`);
      
      await repo.updateCollection(currentCollection.referenceNumber, {
        paidAmount: newPaidAmount,
        periodBalance: newPeriodBalance,
        status: newPaidAmount >= due ? "Paid" : "Partial",
        loanBalance: Math.max((currentCollection.loanBalance || currentCollection.periodAmount) - paymentToApply, 0),
        mode,
        paidAt: now,
      });
      
      const paymentLogEntry = {
        loanId: collection.loanId,
        referenceNumber: generatePaymentRef(currentCollection.referenceNumber),
        borrowersId: collection.borrowersId,
        collector: collection.collector,
        amount: paymentToApply,
        balance: newPeriodBalance,
        paidToCollection: currentCollection.collectionNumber,
        mode,
        datePaid: now,
        prevStatus: prevColStatus,
        createdAt: now,
      };
      
      console.log(`[PAYMENT_LOG] Collection ${currentCollection.collectionNumber}: ₱${paymentToApply}`);
      
      paymentLogs.push(paymentLogEntry);
      totalApplied += paymentToApply;
      remainingAmount -= paymentToApply;
      
      console.log(`[PROGRESS] Total applied: ₱${totalApplied}, Remaining: ₱${remainingAmount}`);
      
      collectionIndex++;
    }
    
    console.log(`[FIXED_TERM_COMPLETE] Total applied: ₱${totalApplied}, Payment logs created: ${paymentLogs.length}`);
    
    if (DEBUG) {
      console.log(`[DEBUG] Payment logs breakdown:`);
      paymentLogs.forEach((log, idx) => {
        console.log(`  [${idx}] Collection ${log.paidToCollection}: ₱${log.amount}`);
      });
    }
    
    if (paymentLogs.length > 0) {
      if (DEBUG) console.log(`[DEBUG] About to insert ${paymentLogs.length} payment logs`);
      await repo.insertPayments(paymentLogs);
      console.log(`[PAYMENTS_INSERTED] ${paymentLogs.length} payment log(s) inserted`);
    }
    
    if (DEBUG) console.log(`[DEBUG] About to increment loan with paidAmount: ₱${totalApplied}, balance: -₱${totalApplied}`);
    await repo.incrementLoan(collection.loanId, { paidAmount: totalApplied, balance: -totalApplied });
    console.log(`[LOAN_INCREMENT] Incrementing loan ${collection.loanId} with paidAmount: ₱${totalApplied}`);
  }

  // --- UPDATE LOAN STATUS ---
  const updatedLoanCollections = await repo.findLoanCollections(collection.loanId);
  const loanStatus = determineLoanStatus(updatedLoanCollections);
  await repo.updateLoan(collection.loanId, { status: loanStatus });

  // Fetch updated collection to return
  const updatedCollection = await repo.findCollection(referenceNumber);

  console.log(`[COLLECTION_AFTER] referenceNumber: ${updatedCollection.referenceNumber}, status: ${updatedCollection.status}, paidAmount: ${updatedCollection.paidAmount}`);
  const totalPaymentAmount = paymentLogs.reduce((sum, p) => sum + (p.amount || 0), 0);
  console.log(`[PAYMENT_END] Payment of ₱${amount} for ${referenceNumber} completed. Payment logs created: ${paymentLogs.length}, Total amount in logs: ₱${totalPaymentAmount}`);
  
  if (DEBUG) {
    console.log(`[DEBUG_FINAL] Input amount: ₱${amount}`);
    console.log(`[DEBUG_FINAL] Total applied in logs: ₱${totalPaymentAmount}`);
    console.log(`[DEBUG_FINAL] Remaining unapplied: ₱${remainingAmount}`);
    if (totalPaymentAmount > amount) {
      console.error(`[ERROR_DETECTED] Applied amount (₱${totalPaymentAmount}) exceeds input (₱${amount})!`);
    }
  }
  console.log(`\n`);

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
  
  try {
    // Step 1: Fetch current payment
    const currentPayment = await repo.findPaymongoPayment(referenceNumber);
    if (!currentPayment) {
      throw new Error(`PayMongo payment record not found for ${referenceNumber}`);
    }

    // Step 2: Check if already processed or being processed
    if (currentPayment.status === "success") {
      console.warn(`[WARNING] PayMongo payment ${referenceNumber} already marked as success. Checking if payment was applied...`);
      
      // Check if payment was actually applied to the collection
      const collection = await repo.findCollection(referenceNumber);
      const recentPaymentLogs = await db.collection("payment-logs").find({
        referenceNumber: { $regex: `^${referenceNumber}` }
      }).sort({ createdAt: -1 }).limit(1).toArray();
      
      if (recentPaymentLogs.length > 0) {
        console.log(`[ALREADY_APPLIED] Payment already applied to collection ${referenceNumber}. Skipping duplicate.`);
        return {
          message: "Payment already processed",
          borrowersId: currentPayment.borrowersId,
          amount: currentPayment.amount,
          referenceNumber,
          paymentLogs: recentPaymentLogs,
          alreadyProcessed: true,
          ...collection,
        };
      } else {
        // Payment marked as success but NOT applied - apply it now
        console.log(`[RETRY_APPLY] Payment marked as success but not applied. Applying now for ${referenceNumber}`);
        const result = await applyPayment({
          referenceNumber,
          amount: currentPayment.amount,
          mode: "Paymongo",
        }, db);
        
        return {
          ...result,
          alreadyProcessed: true,
          wasRetried: true
        };
      }
    }

    if (currentPayment.status === "processing") {
      console.warn(`[WARNING] PayMongo payment ${referenceNumber} is currently being processed. Preventing concurrent processing.`);
      // Wait a bit for the processing to complete, then fetch again
      await new Promise(resolve => setTimeout(resolve, 2000));
      const updatedPayment = await repo.findPaymongoPayment(referenceNumber);
      if (updatedPayment.status === "success") {
        const collection = await repo.findCollection(referenceNumber);
        return {
          message: "Payment already processed by concurrent request",
          borrowersId: updatedPayment.borrowersId,
          amount: updatedPayment.amount,
          referenceNumber,
          paymentLogs: [],
          alreadyProcessed: true,
          ...collection,
        };
      }
      throw new Error("Payment is being processed by another request. Please try again.");
    }

    // Step 3: Mark as processing to prevent race conditions
    await repo.updatePaymongoPayment(referenceNumber, { 
      status: "processing", 
      updatedAt: new Date(),
      processingStartedAt: new Date()
    });
    console.log(`[PROCESSING_STARTED] PayMongo payment ${referenceNumber} marked as processing`);
    if (DEBUG) console.log(`[DEBUG] Processing lock acquired for ${referenceNumber} at ${new Date().toISOString()}`);

    // Step 4: Check if collection is already paid
    const collection = await repo.findCollection(referenceNumber);
    if (collection && collection.status === "Paid") {
      console.warn(`[WARNING] Collection ${referenceNumber} is already fully paid. Marking paymongo as success.`);
      await repo.updatePaymongoPayment(referenceNumber, { status: "success", paidAt: new Date() });
      return {
        message: "Collection already fully paid",
        borrowersId: currentPayment.borrowersId,
        amount: currentPayment.amount,
        referenceNumber,
        paymentLogs: [],
        alreadyProcessed: true,
        ...collection,
      };
    }

    // Step 5: Apply payment to collections/loan
    console.log("[DEBUG] Applying PayMongo payment of", currentPayment.amount, "to collection", referenceNumber);
    const result = await applyPayment({
      referenceNumber,
      amount: currentPayment.amount,
      mode: "Paymongo",
    }, db);
    
    console.log("[DEBUG] PayMongo payment applied successfully. Payment logs:", result.paymentLogs?.length || 0);

    // Step 6: Mark as success after payment is successfully applied
    const now = new Date();
    await repo.updatePaymongoPayment(referenceNumber, { status: "success", paidAt: now });
    console.log(`[PAYMENT_SUCCESS] PayMongo payment ${referenceNumber} marked as success`);

    // Step 7: Notify assigned collector if present
    const borrower = await db.collection("borrowers_account").findOne(
      { borrowersId: currentPayment.borrowersId },
      { projection: { assignedCollectorId: 1, name: 1 } }
    );

    if (borrower?.assignedCollectorId) {
      const decryptedName = borrower.name ? require("../utils/crypt").decrypt(borrower.name) : "Unknown";
      const notifRepo = require("../repositories/notificationRepository")(db);
      await notifRepo.insertCollectorNotification({
        type: "paymongo-payment-received",
        title: "PayMongo Payment Received",
        message: `Payment of ₱${currentPayment.amount.toLocaleString()} via PayMongo for collection ${referenceNumber} has been received from ${decryptedName}.`,
        referenceNumber,
        actor: decryptedName,
        collectorId: borrower.assignedCollectorId,
        read: false,
        viewed: false,
        createdAt: now,
      });
    }
    
    return result;
  } catch (err) {
    // If payment application fails, mark as failed so we can retry
    console.error("[ERROR] Payment application failed:", err.message);
    if (DEBUG) console.error("[ERROR] Stack:", err.stack);
    try {
      await repo.updatePaymongoPayment(referenceNumber, { 
        status: "failed", 
        errorMessage: err.message, 
        updatedAt: new Date() 
      });
    } catch (updateErr) {
      console.error("[ERROR] Failed to update payment status to failed:", updateErr.message);
    }
    throw err;
  }
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
            success: `${FRONTEND_URL}/userPage/borrowerPage/payMongoTools/payment-success/${referenceNumber}`,
            failed: `${FRONTEND_URL}/borrower/payment-failed/${referenceNumber}`,
            // success: `http://localhost:3000/userPage/borrowerPage/payMongoTools/payment-success/${referenceNumber}`,
            // failed: `http://localhost:3000/borrower/payment-failed/${referenceNumber}`,
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
