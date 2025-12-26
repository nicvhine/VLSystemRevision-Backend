const { z } = require("zod");

const borrowerSchema = z.object({
  borrowersId: z.string(),
  name: z.string(),
  role: z.string(),
  username: z.string(),
  password: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
  profilePic: z.string().optional(),
});

module.exports = borrowerSchema;
