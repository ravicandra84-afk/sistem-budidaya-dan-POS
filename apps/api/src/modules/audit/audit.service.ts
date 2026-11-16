import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UserRole } from "@pfi/shared";
import { PaginationQuery } from "@pfi/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery, role: UserRole) {
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
      ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
    };
    const where: Prisma.AuditLogWhereInput = {
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(role === "Kepala Budidaya"
        ? { action: { in: ["CREATE_ENTRY", "VOID_ENTRY"] } }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [totalItems, entries] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { actor: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar audit log berhasil dimuat.",
      data: {
        items: entries.map((entry) => ({
          id: entry.id,
          request_id: entry.requestId,
          actor: { id: entry.actor.id, name: entry.actor.name },
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          old_values: entry.oldValues,
          new_values: entry.newValues,
          reason: entry.reason,
          ip_address: entry.ipAddress,
          created_at: entry.createdAt.toISOString(),
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / query.limit),
        },
      },
    };
  }
}
