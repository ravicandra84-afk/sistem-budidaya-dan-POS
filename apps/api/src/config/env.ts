import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(__dirname, "../../../../.env"), quiet: true });

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PREFIX: z.string().regex(/^\/[a-z0-9/]+$/).default("/api/v1"),
  TZ: z.literal("Asia/Jakarta"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://"))
    .refine((value) => decodeURIComponent(new URL(value).username) === "pfi_app_runtime"),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith("CHANGE_ME")),
  JWT_EXPIRES_IN: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().min(1),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(environment: NodeJS.ProcessEnv = process.env): ApiEnvironment {
  const parsed = apiEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const invalidKeys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid API environment configuration: ${invalidKeys.join(", ")}`);
  }

  return parsed.data;
}