const { padId } = require("../utils/generator");
const loanRepository = require("../repositories/loanRepository");
const { scheduleDueNotifications } = require("../services/borrowerNotif");

const createLoan = async (applicationId, db) => {
  const repo = loanRepository(db);

  const application = await repo.findApplicationById(applicationId);
  if (!application) throw new Error("Application not found");
  if (application.status !== "Active")
    throw new Error("Loan can only be generated for applications with status 'Active'");

  const existingLoan = await repo.findExistingLoan(applicationId);
  if (existingLoan)
    throw new Error("Loan already exists for this application");

  if (!application.borrowersId)
    throw new Error("BorrowersId missing. Borrower account must be created first.");

  const borrower = await repo.findBorrowerById(application.borrowersId);
  if (!borrower)
    throw new Error("Borrower not found for the given borrowersId.");

  // Check if this is a reloan application
  const isReloan = application.loanType?.includes("Reloan") || application.applicationType === "Reloan";
  let oldLoanId = null;

  if (isReloan) {
    // Find the most recent active loan for this borrower
    const activeLoans = await db.collection("loans")
      .find({ borrowersId: borrower.borrowersId, status: "Active" })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (activeLoans.length > 0) {
      oldLoanId = activeLoans[0].loanId;

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

  const loan = {
    loanId,
    applicationId,
    borrowersId: borrower.borrowersId,
    profilePic: application.profilePic || "",
    paidAmount: 0,
    balance: Number(application.appTotalPayable),
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
      paidAmount: 0,
      periodBalance: monthlyDue,
      loanBalance: runningBalance,
      runningBalance: runningBalance,
      status: "Unpaid",
      collector: borrower.assignedCollector || "",
      collectorId: borrower.assignedCollectorId,
      note: "",
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
