import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { ApiException } from "../../common/http/api-exception";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateUserInput, UpdateUserInput } from "./users.schemas";

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserSelect }>;
type UserAuditChange = {
  action:
    | "USER_UPDATED"
    | "USER_DEACTIVATED"
    | "USER_REACTIVATED"
    | "USER_PASSWORD_RESET";
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
};

@Injectable()
export class UsersService {
  private readonly bcryptSaltRounds = loadApiEnvironment().BCRYPT_SALT_ROUNDS;

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      select: safeUserSelect,
      orderBy: [{ createdAt: "desc" }, { name: "asc" }, { id: "asc" }],
    });

    return {
      status: "success" as const,
      message: "Daftar user berhasil dimuat.",
      data: { items: users.map((user) => this.serializeUser(user)) },
    };
  }

  async create(
    input: CreateUserInput,
    actor: AuthenticatedUser,
    request: RequestWithId,
  ) {
    const passwordHash = await bcrypt.hash(
      input.password,
      this.bcryptSaltRounds,
    );

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.user.findFirst({
          where: { email: { equals: input.email, mode: "insensitive" } },
          select: { id: true },
        });
        if (duplicate) throw this.emailConflict();

        const [created] = await transaction.$queryRaw<SafeUser[]>`
          INSERT INTO public.users
            (name, email, password_hash, role, is_active)
          VALUES
            (${input.name}, ${input.email}, ${passwordHash}, ${input.role}, true)
          RETURNING
            id, name, email, role,
            is_active AS "isActive", created_at AS "createdAt"
        `;
        if (!created) throw new Error("User insert returned no row.");

        await transaction.auditLog.create({
          data: {
            requestId: request.requestId,
            actorId: actor.id,
            action: "USER_CREATED",
            entityType: "users",
            entityId: created.id,
            newValues: {
              name: created.name,
              email: created.email,
              role: created.role,
              is_active: created.isActive,
            },
            ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
          },
        });

        return created;
      });

      return {
        status: "success" as const,
        message: "User berhasil dibuat.",
        data: this.serializeUser(user),
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.emailConflict();
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: AuthenticatedUser,
    request: RequestWithId,
  ) {
    const passwordHash =
      input.password === undefined
        ? undefined
        : await bcrypt.hash(input.password, this.bcryptSaltRounds);

    const user = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({
        where: { id },
        select: safeUserSelect,
      });
      if (!current) {
        throw new ApiException(404, "NOT_FOUND", "User tidak ditemukan.");
      }

      if (
        id === actor.id &&
        (input.is_active === false ||
          (input.role !== undefined && input.role !== "Owner"))
      ) {
        throw new ApiException(
          400,
          "SELF_LOCKOUT_PREVENTED",
          "Owner tidak dapat menonaktifkan diri sendiri atau mengubah role sendiri dari Owner.",
        );
      }

      const data: Prisma.UserUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
        ...(passwordHash !== undefined ? { passwordHash } : {}),
      };
      const updated =
        Object.keys(data).length === 0
          ? current
          : await transaction.user.update({
              where: { id },
              data,
              select: safeUserSelect,
            });

      const changes: UserAuditChange[] = [];
      if (
        (input.name !== undefined && input.name !== current.name) ||
        (input.role !== undefined && input.role !== current.role)
      ) {
        changes.push({
          action: "USER_UPDATED",
          oldValues: {
            ...(input.name !== undefined ? { name: current.name } : {}),
            ...(input.role !== undefined ? { role: current.role } : {}),
          },
          newValues: {
            ...(input.name !== undefined ? { name: updated.name } : {}),
            ...(input.role !== undefined ? { role: updated.role } : {}),
          },
        });
      }

      if (
        input.is_active !== undefined &&
        input.is_active !== current.isActive
      ) {
        changes.push({
          action: input.is_active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
          oldValues: { is_active: current.isActive },
          newValues: { is_active: updated.isActive },
        });
      }

      if (input.password !== undefined) {
        changes.push({
          action: "USER_PASSWORD_RESET",
          newValues: { password_reset: true },
        });
      }

      for (const change of changes) {
        await transaction.auditLog.create({
          data: {
            requestId: request.requestId,
            actorId: actor.id,
            action: change.action,
            entityType: "users",
            entityId: updated.id,
            ...(change.oldValues ? { oldValues: change.oldValues } : {}),
            ...(change.newValues ? { newValues: change.newValues } : {}),
            ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
          },
        });
      }

      return updated;
    });

    return {
      status: "success" as const,
      message: "User berhasil diperbarui.",
      data: this.serializeUser(user),
    };
  }

  private serializeUser(user: SafeUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.isActive,
      created_at: user.createdAt.toISOString(),
    };
  }

  private emailConflict(): ApiException {
    return new ApiException(
      409,
      "USER_EMAIL_CONFLICT",
      "Email sudah digunakan.",
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

    return (
      error.code === "P2002" ||
      (error.code === "P2010" && error.meta?.code === "23505")
    );
  }
}
