import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getLocalMigrationUrl } from "./runtime-env";

const ownerCredentialsSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.email().transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((password) => !password.startsWith("CHANGE_ME")),
});

async function provisionOwner(): Promise<void> {
  const credentials = ownerCredentialsSchema.safeParse({
    name: process.env.SEED_INITIAL_OWNER_NAME,
    email: process.env.SEED_INITIAL_OWNER_EMAIL,
    password: process.env.SEED_INITIAL_OWNER_PASSWORD,
  });

  if (!credentials.success) {
    const invalidKeys = [...new Set(credentials.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Missing or invalid Owner seed configuration: ${invalidKeys.join(", ")}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: getLocalMigrationUrl() } } });

  try {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: credentials.data.email, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      console.log("Owner account already exists; no account fields were changed.");
      return;
    }

    const passwordHash = await bcrypt.hash(
      credentials.data.password,
      Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    );

    try {
      await prisma.user.create({
        data: {
          name: credentials.data.name,
          email: credentials.data.email,
          passwordHash,
          role: "Owner",
        },
      });
      console.log("Initial Owner account created.");
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.log("Owner account already exists; no account fields were changed.");
        return;
      }

      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

provisionOwner().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner provisioning failed.");
  process.exitCode = 1;
});