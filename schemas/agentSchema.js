const { z } = require('zod');

const agentSchema = z.object({
    agentId: z.string(),
    name: z.string().min(1).transform((val) => val.trim()),
    phoneNumber: z.string().min(1).transform((val) => val.trim()),
    handledLoans: z.number().int().nonnegative().default(0),
    totalLoanAmount: z.number().nonnegative().default(0),
    totalCommission: z.number().nonnegative().default(0),
    createdAt: z.coerce.date()
});

module.exports = agentSchema;
