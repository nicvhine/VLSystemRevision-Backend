const { decrypt } = require("../utils/crypt");
const { generateApplicationId } = require("../utils/generator");
const { computeApplicationAmounts } = require("../utils/loanCalculations");
const { encrypt } = require("../utils/crypt");
const { sendSMS } = require("../services/smsService");
const notificationRepository = require("../repositories/notificationRepository");

// --- Decrypt functions ---
const decryptApplication = (app) => ({
  ...app,
  appName: decrypt(app.appName),
  appContact: decrypt(app.appContact),
  appEmail: decrypt(app.appEmail),
  appSpouseName: decrypt(app.appSpouseName),
  appAddress: decrypt(app.appAddress),
  appReferences: app.appReferences?.map((r) => ({
    name: decrypt(r.name),
    contact: decrypt(r.contact),
    relation: r.relation,
  })),
});

const decryptInterview = (interview) => ({
  ...interview,
  appName: interview.appName ? decrypt(interview.appName) : "",
  appAddress: interview.appAddress ? decrypt(interview.appAddress) : "",
});

// --- Fetch / Stats functions ---
async function getAllApplications(repo) {
  const applications = await repo.getAllApplications();
  return applications.map(decryptApplication);
}

async function getInterviewList(repo) {
  const interviews = await repo.getInterviewList();
  return interviews.map(decryptInterview);
}

async function getStatusStats(repo) {
  const applied = await repo.countByStatus(/^applied$/i);
  const approved = await repo.countByStatus(/^approved$/i);
  const denied = await repo.countByStatus(/^denied$/i);
  return { applied, approved, denied };
}

async function getLoanTypeStats(repo) {
  return await repo.getLoanTypeStats();
}

async function getApplicationById(repo, applicationId) {
  return await repo.getApplicationById(applicationId);
}

// --- Main loan creation function ---
async function createLoanApplication(req, loanType, repo, db, uploadedFiles, borrowersId = null) {
  const {
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
  if (!appAgent) throw new Error("Agent must be selected for this application.");
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
    throw new Error("Invalid format for character references.");
  }

  if (!Array.isArray(parsedReferences) || parsedReferences.length !== 3)
    throw new Error("Three references must be provided.");

  const names = new Map();
  const numbers = new Map();
  parsedReferences.forEach((r, idx) => {
    const nameKey = (r.name || "").trim().toLowerCase();
    const numKey = (r.contact || "").trim();
    if (nameKey) names.set(nameKey, [...(names.get(nameKey) || []), idx]);
    if (numKey) numbers.set(numKey, [...(numbers.get(numKey) || []), idx]);
  });
  if ([...names.values(), ...numbers.values()].some(arr => arr.length > 1))
    throw new Error("Reference names and contact numbers must be unique.");

  // --- Validate documents ---
  const profilePic = uploadedFiles.find(f => f.folder.includes("userProfilePictures"));
  const documents = uploadedFiles.filter(f => f.folder.includes("documents"));

  if (
    !documents ||
    (loanType === "without" && documents.length < 4) ||
    (loanType !== "without" && documents.length < 6)
  ) {
    throw new Error(
      loanType === "without"
        ? "4 supporting documents must be uploaded."
        : "6 supporting documents must be uploaded."
    );
  }

  // --- Validate required fields ---
  if (!appName || !appDob || !appContact || !appEmail || !appAddress || !appLoanPurpose || !appLoanAmount)
    throw new Error("All required fields must be provided.");

  if (loanType !== "open-term" && !appLoanTerms)
    throw new Error("Loan terms are required.");

  if ((loanType === "with" || loanType === "open-term") &&
      (!collateralType || !collateralValue || !collateralDescription || !ownershipStatus))
    throw new Error("All collateral fields are required.");

  if (sourceOfIncome === "business") {
    if (!appTypeBusiness || !appBusinessName || !appDateStarted || !appBusinessLoc || appMonthlyIncome == null)
      throw new Error("Business fields are required for business income source.");
  } else if (sourceOfIncome === "employed") {
    if (!appOccupation || !appEmploymentStatus || !appCompanyName || appMonthlyIncome == null)
      throw new Error("Employment fields are required for employed income source.");
  } else {
    throw new Error("Invalid source of income.");
  }

  // --- Generate Application ID ---
  const applicationId = await generateApplicationId(repo.loanApplications);
  const principal = Number(appLoanAmount);
  const interestRate = Number(appInterest);
  const terms = Number(appLoanTerms) || null;

  const {
    interestAmount,
    totalInterestAmount,
    totalPayable,
    appMonthlyDue,
  } = computeApplicationAmounts(principal, interestRate, terms, loanType);

  // --- Build new application object ---
  let newApplication = {
    applicationId,
    borrowersId: borrowersId || null, // Store borrowersId if provided
    appName: encrypt(appName),
    appDob,
    appContact: encrypt(appContact),
    appEmail: encrypt(appEmail),
    appMarital,
    appChildren,
    appSpouseName: encrypt(appSpouseName),
    appSpouseOccupation,
    appAddress: encrypt(appAddress),
    appMonthlyIncome: appMonthlyIncome?.toString(),
    appLoanPurpose,
    appLoanAmount: principal.toString(),
    appInterestRate: interestRate.toString(),
    appInterestAmount: interestAmount,
    appReferences: parsedReferences.map((r) => ({
      name: encrypt(r.name),
      contact: encrypt(r.contact),
      relation: r.relation,
    })),
    appAgent: assignedAgent ? { id: assignedAgent.agentId, name: assignedAgent.name } : "no agent",
    hasCollateral: loanType !== "without",
    collateralType,
    collateralValue: collateralValue?.toString(),
    collateralDescription,
    ownershipStatus,
    loanType:
      loanType === "without"
        ? "Regular Loan Without Collateral"
        : loanType === "with"
        ? "Regular Loan With Collateral"
        : "Open-Term Loan",
    status: "Applied",
    dateApplied: new Date(),
    profilePic: profilePic
      ? {
          fileName: profilePic.fileName,
          filePath: profilePic.filePath,
          mimeType: profilePic.mimeType,
        }
      : null,
    documents,
    hasServiceFee: "false",
  };

  if (sourceOfIncome === "business") {
    newApplication = { ...newApplication, sourceOfIncome, appTypeBusiness, appBusinessName, appDateStarted, appBusinessLoc };
  } else {
    newApplication = { ...newApplication, sourceOfIncome, appOccupation, appEmploymentStatus, appCompanyName };
  }


  // --- Conditionally add fields based on loan type ---
  if (loanType !== "open-term") {
    newApplication.appLoanTerms = terms;
    newApplication.appTotalInterestAmount = totalInterestAmount;
    newApplication.appTotalPayable = totalPayable;
    newApplication.appMonthlyDue = appMonthlyDue;
  }

  // --- Persist application ---
  await repo.insertLoanApplication(newApplication);

  // --- Notifications ---
  try {
    const notifRepo = notificationRepository(db);
    // Notify Loan Officer
    await notifRepo.insertLoanOfficerNotification({
      type: "new-application",
      title: "New Loan Application Received",
      message: `A new loan application has been submitted by ${appName}. Please review and process at your earliest convenience.`,
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
      message: `A new loan application (${applicationId}) from ${appName} has been submitted and requires managerial review.`,
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
    const message = `Good day ${decryptedName}! Your loan application has been successfully submitted to Vistula Lending Corporation. Your Application ID is ${applicationId}. We will notify you once it has been reviewed. Thank you!`;

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

  return newApplication;
}

// --- Compute loan fields helper ---
function computeLoanFields(principal, months = 12, interestRate = 0, loanType = "regular") {
  principal = Number(principal || 0);
  months = Number(months || 12);
  interestRate = Number(interestRate || 0);

  const interestAmount = principal * (interestRate / 100);
  const totalInterestAmount = interestAmount * months;
  const totalPayable = principal + totalInterestAmount;
  const monthlyDue = totalPayable / months;

  // For open-term, return only minimal fields
  if (loanType === "open-term") {
    return {
      appLoanAmount: principal,
      appInterestRate: interestRate,
      appInterestAmount: interestAmount,
    };
  }

  return {
    appLoanAmount: principal,
    appLoanTerms: months,
    appInterestRate: interestRate,
    appInterestAmount: interestAmount,
    appTotalInterestAmount: totalInterestAmount,
    appTotalPayable: totalPayable,
    appMonthlyDue: monthlyDue,
  };
}

module.exports = {
  getAllApplications,
  getInterviewList,
  getStatusStats,
  getLoanTypeStats,
  createLoanApplication,
  getApplicationById,
  decryptApplication,
  computeLoanFields
};