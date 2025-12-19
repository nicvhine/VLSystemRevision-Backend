const { z } = require('zod');

const loanSchema = z.object({
    loanId: z.string(),
    applicationId: z.string(),  
    borrowersId: z.string(),
    profilePic: z.string().optional(),
    paidAmount: z.number().min(0),
    balance: z.number().min(0),
    status: z.enum(["Active", "Inactive"]), 
    dateDisbursed: z.coerce.date(),
    createdAt: z.coerce.date()
});

module.exports = loanSchema;
