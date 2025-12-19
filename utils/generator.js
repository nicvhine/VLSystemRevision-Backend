// Left-pad numeric ids to 5 digits
const padId = (num) => num.toString().padStart(5, "0");

// Generate next agent id (AGTxxxxx)
async function generateAgentId(db) {
  const lastAgent = await db.collection("agents")
    .find({})
    .sort({ agentId: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastAgent.length > 0) {
    const lastId = lastAgent[0].agentId;
    const idString = typeof lastId === "string" ? lastId : String(lastId ?? "");
    const sanitized = idString.replace(/[^0-9]/g, "");
    const numPart = parseInt(sanitized, 10);
    if (!Number.isNaN(numPart)) nextNumber = numPart + 1;
  }

  return `AGT${padId(nextNumber)}`;
}

// Generate next application id (APLxxxxx)
async function generateApplicationId(loanApplications) {
  const lastApplication = await loanApplications
    .find({})
    .sort({ applicationId: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastApplication.length > 0) {
    const lastId = lastApplication[0].applicationId;
    const numPart = parseInt(lastId.replace("APL", ""), 10);
    if (!isNaN(numPart)) nextNumber = numPart + 1;
  }

  return `APL${padId(nextNumber)}`;
}

// Generate next borrower id (BWRxxxxx)
async function generateBorrowerId(borrowersCollection) {
  const lastBorrower = await borrowersCollection
    .find({})
    .sort({ borrowersId: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastBorrower.length > 0) {
    const lastId = lastBorrower[0].borrowersId;
    const numPart = parseInt(lastId.replace("BWR", ""), 10);
    if (!isNaN(numPart)) nextNumber = numPart + 1;
  }

  return `BWR${padId(nextNumber)}`;
}


async function generateClosureEndorsementId(endorsementsCollection) {
  const lastEndorsement = await endorsementsCollection
    .find({})
    .sort({ endorsementId: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastEndorsement.length > 0) {
    const lastId = lastEndorsement[0].endorsementId;
    if (lastId && typeof lastId === "string") {
      const numPart = parseInt(lastId.replace("CE", ""), 10);
      if (!isNaN(numPart)) nextNumber = numPart + 1;
    }
  }

  return `CE${padId(nextNumber)}`;
}

async function generatePenaltyEndorsementId(endorsementsCollection) {
  const lastEndorsement = await endorsementsCollection
    .find({})
    .sort({ endorsementId: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastEndorsement.length > 0) {
    const lastId = lastEndorsement[0].endorsementId;
    if (lastId && typeof lastId === "string") {
      const numPart = parseInt(lastId.replace("PE", ""), 10);
      if (!isNaN(numPart)) nextNumber = numPart + 1;
    }
  }

  return `CE${padId(nextNumber)}`;
}



module.exports = { padId, generateAgentId, generateApplicationId, generateBorrowerId, generateClosureEndorsementId, generatePenaltyEndorsementId };
