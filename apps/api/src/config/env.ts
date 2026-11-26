import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({
  path: resolve(__dirname, "../../../../.env"),
  quiet: true,
  override: true,
});

const originSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  });

const apiEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PREFIX: z
    .string()
    .regex(/^\/[a-z0-9/]+$/)
    .default("/api/v1"),
  TZ: z.literal("Asia/Jakarta"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://"))
    .refine((value) => {
      try {
        return /^pfi_app_runtime(\.[a-z0-9]{15,32})?$/.test(
          decodeURIComponent(new URL(value).username),
        );
      } catch {
        return false;
      }
    }),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith("CHANGE_ME")),
  JWT_EXPIRES_IN: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  FRONTEND_URL: originSchema,
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .refine((value) =>
      value
        .split(",")
        .every((origin) => originSchema.safeParse(origin.trim()).success),
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  DB_LOCK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(60_000)
    .default(5_000),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ApiEnvironment {
  const parsed = apiEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const invalidKeys = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid API environment configuration: ${invalidKeys.join(", ")}`,
    );
  }

  return parsed.data;
}
