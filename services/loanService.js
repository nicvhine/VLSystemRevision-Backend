const { padId } = require("../utils/generator");
const loanRepository = require("../repositories/loanRepository");
const { scheduleDueNotifications } = require("../services/borrowerNotif");

const createLoan = async (applicationId, db) => {
  const repo = loanRepository(db);

  const application = await repo.findApplicationById(applicationId);
  if (!application) throw new Error("Application not found");


  // Debug: Log the full application object to see what fields exist
  console.log(`[CREATELOAN_DEBUG] Full application fields:`, {
    applicationId: application.applicationId,
    isReloan: application.isReloan,
    applicationType: application.applicationType,
    loanType: application.loanType,
    status: application.status,
    borrowersId: application.borrowersId,
    keys: Object.keys(application)
  });

  const existingLoan = await repo.findExistingLoan(applicationId);
  if (existingLoan)
    throw new Error("Loan already exists for this application");

  if (!application.borrowersId)
    throw new Error("BorrowersId missing. Borrower account must be created first.");

  const borrower = await repo.findBorrowerById(application.borrowersId);
  if (!borrower)
    throw new Error("Borrower not found for the given borrowersId.");

  // Check if this is a reloan application
  // Check multiple indicators: loanType containing "Reloan", applicationType === "Reloan", or isReloan boolean flag
  const isReloan = application.loanType?.includes("Reloan") || 
                   application.applicationType === "Reloan" || 
                   application.isReloan === true;
  
  console.log(`[RELOAN_DETECTION] applicationId=${application.applicationId}, loanType=${application.loanType}, applicationType=${application.applicationType}, isReloan=${application.isReloan}, detected=${isReloan}`);
  
  let oldLoanId = null;

  if (isReloan) {
    // Find the most recent active loan for this borrower
    const activeLoans = await db.collection("loans")
      .find({ borrowersId: borrower.borrowersId, status: "Active" })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    console.log(`[RELOAN_OLD_LOAN_SEARCH] borrowersId=${borrower.borrowersId}, found ${activeLoans.length} active loans`);

    if (activeLoans.length > 0) {
      oldLoanId = activeLoans[0].loanId;
      console.log(`[RELOAN_OLD_LOAN_FOUND] oldLoanId=${oldLoanId}`);

      // Mark the old loan as "Restructured"
      await repo.updateLoanStatus(oldLoanId, "Restructured");
      await repo.updateLoanRestructure(oldLoanId, {
        restructuredAt: new Date(),
      });

      // Mark all unpaid/partial collections as "Transferred"
      const oldCollections = await repo.findLoanCollections(oldLoanId);
      for (const col of oldCollections) {
        if (col.status === "Unpaid" || col.status === "Partial") {
          await db.collection("collections").updateOne(
            { referenceNumber: col.referenceNumber },
            { $set: { status: "Transferred", transferredAt: new Date() } }
          );
        }
      }

      // Close the old application
      await db.collection("loan_applications").updateOne(
        { applicationId: oldLoanId },
        { $set: { status: "Restructured" } }
      );
    } else {
      console.log(`[RELOAN_NO_ACTIVE_LOAN] No active loan found for borrowersId=${borrower.borrowersId}`);
    }
  } else {
    // Not a reloan: close any previously active loans
    const activeLoans = await repo.findActiveLoansByBorrowerId(borrower.borrowersId);
    for (const activeLoan of activeLoans) {
      await repo.updateLoanStatus(activeLoan.loanId, "Completed");

      await db.collection("loan_applications").updateOne(
        { applicationId: activeLoan.applicationId },
        { $set: { status: "Completed" } }
      );

      const collections = await repo.findCollectionsByLoan(activeLoan.loanId);
      for (const col of collections) {
        if (col.status === "Unpaid" || col.status === "Partial") {
          await repo.updateCollectionStatus(col.referenceNumber, "Completed");
        }
      }
    }
  }

  // Auto-increment loanId
  const maxLoan = await repo.getMaxLoan();
  let nextId = 1;
  if (maxLoan.length > 0 && !isNaN(maxLoan[0].loanIdNum))
    nextId = maxLoan[0].loanIdNum + 1;

  const loanId = "L" + padId(nextId);

  // Calculate actual balance for the new loan by accounting for payments made during restructuring
  let newLoanBalance = Number(application.appTotalPayable);
  let paidAmountFromOldLoan = 0;

  if (isReloan && oldLoanId) {
    // Get all paid amounts from the old loan's transferred collections
    const oldCollections = await repo.findLoanCollections(oldLoanId);
    const oldLoanData = await repo.findLoan(oldLoanId);
    
    console.log(`[RELOAN_DEBUG] Found ${oldCollections.length} collections for old loan ${oldLoanId}`);
    console.log(`[RELOAN_DEBUG] Old loan data: paidAmount=${oldLoanData.paidAmount}, balance=${oldLoanData.balance}`);
    console.log(`[RELOAN_DEBUG] Application createdAt: ${application.createdAt}`);
    
    // Get all payments made to this old loan to find which ones were made during restructuring
    const allPaymentsForOldLoan = await db.collection("payments")
      .find({ loanId: oldLoanId })
      .toArray();
    
    console.log(`[RELOAN_DEBUG] Found ${allPaymentsForOldLoan.length} total payments for old loan`);
    
    // Only include payments made AFTER the restructuring application was SUBMITTED by user (dateApplied)
    // NOT after createdAt (server-side timestamp), which may be different
    const appSubmittedTime = new Date(application.dateApplied || application.createdAt).getTime();
    
    const paymentsAfterRestructuring = allPaymentsForOldLoan.filter(p => {
      if (!p.datePaid) {
        console.log(`[RELOAN_FILTER] Skipping payment with no datePaid: ${JSON.stringify(p)}`);
        return false;
      }
      
      const paidTime = new Date(p.datePaid).getTime();
      const isAfter = paidTime > appSubmittedTime;
      
      console.log(`[RELOAN_FILTER] Payment amount=₱${p.amount}, datePaid=${p.datePaid} (${paidTime}), vs appDateApplied=${application.dateApplied} (${appSubmittedTime}), AFTER=${isAfter ? 'YES' : 'NO'}`);
      
      return isAfter;
    });
    
    console.log(`[RELOAN_DEBUG] Filtered ${paymentsAfterRestructuring.length} payments made after restructuring application from ${allPaymentsForOldLoan.length} total`);
    
    for (const payment of paymentsAfterRestructuring) {
      const paymentAmount = Number(payment.amount || 0);
      if (paymentAmount > 0) {
        paidAmountFromOldLoan += paymentAmount;
        console.log(`[RELOAN_DEBUG] Including payment of ₱${paymentAmount} made at ${payment.datePaid}`);
      }
    }
    
    console.log(`[RELOAN_DEBUG] Total paidAmountFromOldLoan calculated: ₱${paidAmountFromOldLoan}`);
    
    // Deduct payments made to old loan from new loan's balance
    if (paidAmountFromOldLoan > 0) {
      newLoanBalance = Math.max(0, newLoanBalance - paidAmountFromOldLoan);
      console.log(`[RELOAN_BALANCE_ADJUSTMENT] Old loan total payments (during restructuring): ₱${paidAmountFromOldLoan}, New loan balance adjusted from ₱${Number(application.appTotalPayable)} to ₱${newLoanBalance}`);
    } else {
      console.log(`[RELOAN_BALANCE_ADJUSTMENT] No payments found in old loan made after restructuring application`);
    }
  }

  const loan = {
    loanId,
    applicationId,
    borrowersId: borrower.borrowersId,
    profilePic: application.profilePic || "",
    paidAmount: paidAmountFromOldLoan,
    balance: newLoanBalance,
    status: "Active",
    loanType: application.loanType,
    restructuredFromLoanId: oldLoanId || undefined,
    restructureReason: isReloan ? "reloan" : undefined,
    restructureDate: isReloan ? new Date() : undefined,
    dateDisbursed: application.dateDisbursed || new Date(),
    creditScore: 10,
    appInterestRate: Number(application.appInterestRate) || 0,
    createdAt: new Date(),
  };

  console.log(`[LOAN_CREATION] New loan created: loanId=${loanId}, paidAmount=${paidAmountFromOldLoan}, balance=${newLoanBalance}, restructuredFromLoanId=${oldLoanId}`);
  console.log(`[LOAN_CREATION_DETAILS]`, JSON.stringify(loan, null, 2));

  await repo.insertLoan(loan);

  /* ----- FIXED TERM COLLECTION GENERATION (intact) ----- */
  const termsInMonths = Number(application.appLoanTerms) || 0;
  const principal = Number(application.appLoanAmount);
  const interestRate = Number(application.appInterestRate) || 0;

  const interestAmount = principal * (interestRate / 100);
  const monthlyDue = termsInMonths
    ? (principal + interestAmount * termsInMonths) / termsInMonths
    : 0;

  let runningBalance = principal + interestAmount * termsInMonths;

  const disbursedDate = new Date(application.dateDisbursed || new Date());
  const collections = [];

  for (let i = 0; i < termsInMonths; i++) {
    const dueDate = new Date(disbursedDate);
    dueDate.setMonth(dueDate.getMonth() + (i + 1));

    // For the first collection, if there were payments from old loan during restructuring,
    // mark it as partially paid
    let collectionStatus = "Unpaid";
    let collectionPaidAmount = 0;
    let collectionPeriodBalance = monthlyDue;

    if (i === 0 && paidAmountFromOldLoan > 0) {
      collectionStatus = paidAmountFromOldLoan >= monthlyDue ? "Paid" : "Partial";
      collectionPaidAmount = Math.min(paidAmountFromOldLoan, monthlyDue);
      collectionPeriodBalance = Math.max(0, monthlyDue - collectionPaidAmount);
    }

    collections.push({
      referenceNumber: `${loanId}-C${i + 1}`,
      loanId,
      borrowersId: borrower.borrowersId,
      name: borrower.name,
      collectionNumber: i + 1,
      dueDate,
      periodAmount: monthlyDue,
      periodInterestAmount: interestAmount,
      periodInterestRate: interestRate,
      paidAmount: collectionPaidAmount,
      periodBalance: collectionPeriodBalance,
      loanBalance: runningBalance,
      runningBalance: runningBalance,
      status: collectionStatus,
      collector: borrower.assignedCollector || "",
      collectorId: borrower.assignedCollectorId,
      note: isReloan && i === 0 ? `[Restructured] Payment(s) of ₱${collectionPaidAmount} applied from previous loan` : "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    runningBalance -= monthlyDue;
  }

  if (collections.length > 0) {
    await repo.insertCollections(collections);
    await scheduleDueNotifications(db, collections);
  }

  return loan;
};

const createOpenTermLoan = async (applicationId, db) => {
  const repo = loanRepository(db);

  const application = await repo.findApplicationById(applicationId);
  if (!application) throw new Error("Application not found");

  if (!application.borrowersId)
    throw new Error("BorrowersId missing. Borrower account must be created first.");

  const borrower = await repo.findBorrowerById(application.borrowersId);
  if (!borrower)
    throw new Error("Borrower not found for the given borrowersId.");

  const existingLoan = await repo.findExistingLoan(applicationId);
  if (existingLoan)
    throw new Error("Loan already exists for this application");

  // **NEW: Close previously active loans for this borrower**
  const activeLoans = await repo.findActiveLoansByBorrowerId(borrower.borrowersId);
  for (const activeLoan of activeLoans) {
    // Close the loan
    await repo.updateLoanStatus(activeLoan.loanId, "Closed");

    // Close the corresponding application
    await db.collection("loan_applications").updateOne(
      { applicationId: activeLoan.applicationId },
      { $set: { status: "Closed" } }
    );

    // Close all collections for that loan (mark Unpaid/Partial as Paid)
    const collections = await repo.findCollectionsByLoan(activeLoan.loanId);
    for (const col of collections) {
      if (col.status === "Unpaid" || col.status === "Partial") {
        await repo.updateCollectionStatus(col.referenceNumber, "Closed");
      }
    }
  }

  // Auto-increment loanId
  const maxLoan = await repo.getMaxLoan();
  let nextId = 1;
  if (maxLoan.length > 0 && !isNaN(maxLoan[0].loanIdNum))
    nextId = maxLoan[0].loanIdNum + 1;

  const loanId = "L" + padId(nextId);

  const loan = {
    loanId,
    applicationId,
    borrowersId: borrower.borrowersId,
    profilePic: application.profilePic || "",
    paidAmount: 0,
    balance: Number(application.appLoanAmount),
    status: "Active",
    loanType: "Open-Term Loan",
    dateDisbursed: application.dateDisbursed || new Date(),
    creditScore: 10,
    appInterestRate: Number(application.appInterestRate) || 0,
    createdAt: new Date(),
  };

  await repo.insertLoan(loan);

  const balance = Number(loan.balance);
  const interestRate = Number(application.appInterestRate) || 0;
  const interestAmount = balance * (interestRate / 100);

  const disbursedDate = new Date(application.dateDisbursed || new Date());
  const firstDueDate = new Date(disbursedDate);
  firstDueDate.setMonth(firstDueDate.getMonth() + 1); // Monthly cycle

  const collection = {
    referenceNumber: `${loanId}-C1`,
    loanId,
    borrowersId: borrower.borrowersId,
    name: borrower.name,
    collectionNumber: 1,
    dueDate: firstDueDate,
    periodAmount: interestAmount,     
    periodInterestRate: interestRate,
    periodInterestAmount: interestAmount,
    runningBalance: balance,
    paidAmount: 0,
    periodBalance: interestAmount,
    status: "Unpaid",
    collector: borrower.assignedCollector || "",
    collectorId: borrower.assignedCollectorId,
    note: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await repo.insertCollections([collection]);
  await scheduleDueNotifications(db, [collection]);

  return loan;
};

module.exports = {
  createLoan,
  createOpenTermLoan,
};
