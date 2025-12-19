const { z } = require('zod');

const userSchema = z.object({
    userId: z.string(),
    name: z.string(),
    email: z.string().email(),
    phoneNumber: z.string(),
    role: z.string(),
    username: z.string(),
    password: z.string() 
});

module.exports = userSchema;
