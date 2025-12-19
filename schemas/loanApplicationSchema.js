const { z } = require('zod');
const agentSchema = require("./agentSchema");

const loanApplicationSchema = z.object({
    applicationId: z.string(),
    appName: z.string(),
    appDob: z.string(),
    appContact: z.string(),
    appEmail: z.string(),
    appMarital: z.string(),
    appChildren: z.number().int().nonnegative(),
    appSpouseName: z.string(),
    appSpouseOccupation: z.string(),
    appAddress: z.string(),
    appMonthlyIncome: z.string(),
    appLoanPurpose: z.string(),
    appLoanAmount: z.string(),
    appLoanTerms: z.string(),
    appInterestRate: z.string(),
    appInterestAmount: z.number(),
    appTotalInterestAmount: z.number(),
    appTotalPayable: z.number(),
    appMonthlyDue: z.number(),
    appServiceFee: z.number(),
    appNetReleased: z.number(),
    // appReferences: z.array(referenceSchema), ??
    appAgent: agentSchema,
    hasCollateral: z.boolean(),
    collateralType: z.string().optional(),
    collateralValue: z.string().optional(),
    collateralDescription: z.string().optional(),
    ownershipStatus: z.string().optional(),
    loanType: z.enum([
        "Regular Loan Without Collateral",
        "Regular Loan With Collateral",
        "Open-Term Loan"
    ]),
    status: z.literal("Applied"),
    dateApplied: z.coerce.date(),
    documents: z.any(),
    profilePic: z.string().optional(),

    // Unified source of income fields
    sourceOfIncome: z.enum(["business", "employment"]),
    appTypeBusiness: z.string().optional(),
    appBusinessName: z.string().optional(),
    appDateStarted: z.string().optional(),
    appBusinessLoc: z.string().optional(),
    appOccupation: z.string().optional(),
    appEmploymentStatus: z.string().optional(),
    appCompanyName: z.string().optional()
});

module.exports = loanApplicationSchema;