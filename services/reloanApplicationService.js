'use strict';

const { encrypt } = require("../utils/crypt");
const { generateApplicationId } = require("../utils/generator");
const notificationRepository = require("../repositories/notificationRepository");

function computeApplicationAmounts(principal, interestRate, terms, loanType) {
  const appInterestAmount = principal * (interestRate / 100);
  const appTotalInterestAmount = appInterestAmount * (terms || 1);
  const appTotalPayable = principal + appTotalInterestAmount;
  const appMonthlyDue = loanType !== "open-term" ? appTotalPayable / (terms || 1) : 0;

  let appServiceFee = 0;
  if (principal >= 10000 && principal <= 20000) appServiceFee = principal * 0.05;
  else if (principal > 20000 && principal <= 45000) appServiceFee = 1000;
  else if (principal > 45000) appServiceFee = principal * 0.03;

  const appNetReleased = principal - appServiceFee;

  return { appInterestAmount, appTotalInterestAmount, appTotalPayable, appMonthlyDue, appServiceFee, appNetReleased };
}

async function createReloanApplication(req, loanType, repo, db, uploadedFiles) {
  const {
    borrowersId,
    previousBalance = 0,
    balanceDecision = "deduct",
    sourceOfIncome,
    appName, appDob, appContact, appEmail, appMarital, appChildren,
    appSpouseName, appSpouseOccupation, appAddress,
    appTypeBusiness, appBusinessName, appDateStarted, appBusinessLoc,
    appMonthlyIncome,
    appOccupation, appEmploymentStatus, appCompanyName,
    appLoanPurpose, appLoanAmount, appLoanTerms, appInterest, appReferences, appAgent,
    collateralType, collateralValue, collateralDescription, ownershipStatus
  } = req.body;

  // --- Validate agent ---
  if (!appAgent) throw new Error("Agent must be selected.");
  let assignedAgent = null;
  if (appAgent !== "no agent") {
    assignedAgent = await repo.findAgentById(appAgent);
    if (!assignedAgent) throw new Error("Selected agent does not exist.");
  }

  // --- Validate references ---
  let parsedReferences = [];
  try {
    parsedReferences = typeof appReferences === "string" ? JSON.parse(appReferences) : appReferences;
  } catch {
    throw new Error("Invalid format for references.");
  }
  if (!Array.isArray(parsedReferences) || parsedReferences.length !== 3)
    throw new Error("Three references must be provided.");

  // --- Validate uploads ---
  const profilePic = uploadedFiles.find(f => f.folder.includes("userProfilePictures")) || null;
  const documents = uploadedFiles.filter(f => f.folder.includes("documents")) || [];
  if (documents.length < 4) throw new Error("At least 4 supporting documents must be uploaded.");

  // --- Validate required fields ---
  if (!appName || !appDob || !appContact || !appEmail || !appAddress || !appLoanPurpose || !appLoanAmount)
    throw new Error("All required fields must be provided.");

  // --- Generate application ID ---
  const applicationId = await generateApplicationId(repo.loanApplications);

  // --- Parse numeric fields ---
  const principal = Number(appLoanAmount);
  const interestRate = Number(appInterest || 0);
  const terms = Number(appLoanTerms || 1);
  const prevBalanceNum = Number(previousBalance || 0);

  // --- Compute base loan amounts ---
  let amounts = computeApplicationAmounts(principal, interestRate, terms, loanType);
  let appNewLoanAmount = principal;

  // --- Handle previous balance ---
  if (prevBalanceNum > 0) {
    if (balanceDecision === "deduct") {
      amounts.appNetReleased = principal - amounts.appServiceFee - prevBalanceNum;
      if (amounts.appNetReleased < 0) amounts.appNetReleased = 0;
    } else if (balanceDecision === "addPrincipal") {
      appNewLoanAmount = principal + prevBalanceNum;
      amounts = computeApplicationAmounts(appNewLoanAmount, interestRate, terms, loanType);
    }
  }

  // --- Build application object ---
  const newApplication = {
    applicationId,
    borrowersId: borrowersId || null,
    appName: encrypt(appName),
    appDob,
    appContact: encrypt(appContact),
    appEmail: encrypt(appEmail),
    appMarital,
    appChildren,
    appSpouseName: encrypt(appSpouseName || ""),
    appSpouseOccupation: appSpouseOccupation || "",
    appAddress: encrypt(appAddress),
    appMonthlyIncome: appMonthlyIncome?.toString() || "0",
    appLoanPurpose,
    appLoanAmount: appNewLoanAmount.toString(),
    appLoanTerms: terms.toString(),
    appInterestRate: interestRate.toString(),
    appInterestAmount: amounts.appInterestAmount,
    appTotalInterestAmount: amounts.appTotalInterestAmount,
    appTotalPayable: amounts.appTotalPayable,
    appMonthlyDue: amounts.appMonthlyDue,
    appServiceFee: amounts.appServiceFee,
    appNetReleased: amounts.appNetReleased,
    appReferences: parsedReferences.map((r) => ({
      name: encrypt(r.name),
      contact: encrypt(r.contact),
      relation: r.relation,
    })),
    appAgent: assignedAgent ? { id: assignedAgent.agentId, name: assignedAgent.name } : "no agent",
    hasCollateral: loanType !== "without",
    collateralType: collateralType || null,
    collateralValue: collateralValue?.toString() || "0",
    collateralDescription: collateralDescription || null,
    ownershipStatus: ownershipStatus || null,
    loanType: loanType === "without" ? "Regular Loan Without Collateral" : "Regular Loan With Collateral",
    status: "Applied",
    isReloan: true,
    previousBalance: prevBalanceNum,
    balanceDecision,
    dateApplied: new Date(),
    profilePic: profilePic
      ? {
          fileName: profilePic.fileName,
          filePath: profilePic.filePath,
          mimeType: profilePic.mimeType,
        }
      : null,
    documents,
    sourceOfIncome,
    hasServiceFee: "false",
  };

  // --- Add income details ---
  if (sourceOfIncome === "business") {
    newApplication.appTypeBusiness = appTypeBusiness || "";
    newApplication.appBusinessName = appBusinessName || "";
    newApplication.appDateStarted = appDateStarted || "";
    newApplication.appBusinessLoc = appBusinessLoc || "";
  } else {
    newApplication.appOccupation = appOccupation || "";
    newApplication.appEmploymentStatus = appEmploymentStatus || "";
    newApplication.appCompanyName = appCompanyName || "";
  }

  // --- Insert into repository ---
  await repo.insertLoanApplication(newApplication);

  // --- Notifications ---
  try {
    const notifRepo = notificationRepository(db);
    // Notify Loan Officer
    await notifRepo.insertLoanOfficerNotification({
      type: "new-application",
      title: "New Loan Application Received",
      message: `A new reloan application has been submitted by ${appName}. Please review and process at your earliest convenience.`,
      applicationId,
      actor: "System",
      read: false,
      viewed: false,
      createdAt: new Date(),
    });
    // Notify Manager
    await notifRepo.insertManagerNotification({
      type: "new-application",
      title: "New Loan Application for Review",
      message: `A new reloan application (${applicationId}) from ${appName} has been submitted and requires managerial review.`,
      applicationId,
      actor: "System",
      read: false,
      viewed: false,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("Failed to create application notifications:", err?.message || err);
  }

  // --- SMS to applicant ---
  try {
    const decryptedName = appName;
    const decryptedContact = appContact;
    const message = `Good day ${decryptedName}! Your reloan application has been successfully submitted to Vistula Lending Corporation. Your Application ID is ${applicationId}. We will notify you once it has been reviewed. Thank you!`;

    await sendSMS(decryptedContact, message);
  } catch (err) {
    console.error("Failed to send applicant SMS:", err?.message || err);
  }  

  // --- SMS to references ---
  try {
    for (const ref of parsedReferences) {
      const message = `Good day ${ref.name}, ${appName} has listed you as a reference for their loan application at Vistula Lending Corporation. You may be contacted for verification. Thank you!`;
      await sendSMS(ref.contact, message);
    }
  } catch (err) {
    console.error("Failed to send reference notifications:", err?.message || err);
  }
  if (newApplication.borrowersId) {
    const notification = {
      borrowersId: newApplication.borrowersId,
      message: `Your re-loan application (${newApplication.applicationId}) has been submitted successfully.`,
      read: false,
      viewed: false,
      createdAt: new Date(),
    };

    // Directly insert into MongoDB collection
    const notificationsCollection = db.collection("borrower_notifications");
    await notificationsCollection.insertOne(notification);
  }
  
  return newApplication;
}

module.exports = {
  createReloanApplication
};
