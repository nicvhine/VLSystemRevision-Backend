const { z } = require("zod");

const otpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  expiresAt: z.coerce.date(),
  verified: z.boolean(),
});

module.exports = otpSchema;
