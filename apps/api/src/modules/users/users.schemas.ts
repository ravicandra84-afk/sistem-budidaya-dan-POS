import { USER_ROLES } from "@pfi/shared";
import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(255);
const passwordSchema = z.string().min(8).max(72);
const roleSchema = z.enum(USER_ROLES);

export const createUserSchema = z
  .object({
    name: nameSchema,
    email: z
      .string()
      .trim()
      .email()
      .max(255)
      .transform((email) => email.toLowerCase()),
    password: passwordSchema,
    role: roleSchema,
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    is_active: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined));

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
