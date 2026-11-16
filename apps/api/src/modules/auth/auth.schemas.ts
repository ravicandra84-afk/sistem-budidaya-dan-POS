import { z } from "zod";

export const loginSchema = z
  .object({
    email: z.email().transform((email) => email.trim().toLowerCase()),
    password: z.string().min(1).max(72),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
