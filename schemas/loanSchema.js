const { z } = require('zod');

const loanSchema = z.object({
    loanId: z.string(),
    applicationId: z.string(),  
    borrowersId: z.string(),
    profilePic: z.string().optional(),
    paidAmount: z.number().min(0),
    balance: z.number().min(0),
    status: z.enum(["Active", "Inactive", "Restructured", "Completed", "Defaulted"]),
    restructuredFromLoanId: z.string().optional(), // Track if this is a reloan
    restructureReason: z.string().optional(), // "reloan" or "restructuring"
    restructureDate: z.coerce.date().optional(),
    dateDisbursed: z.coerce.date(),
    createdAt: z.coerce.date()
});

module.exports = loanSchema;
