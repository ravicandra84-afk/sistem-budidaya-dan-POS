import { BatchesService } from "../src/modules/batches/batches.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import type { AuthenticatedUser } from "../src/common/auth/jwt-auth.guard";

const batchId = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const actorId = "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3";
const idempotencyId = "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4";
const idempotencyKey = "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5";

function createService(
  status = "active",
  readiness: "BELUM_SIAP" | "SIAP_JUAL" = "BELUM_SIAP",
) {
  const transaction = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes('INSERT INTO "idempotency_keys"')) {
        return Promise.resolve([{ id: idempotencyId }]);
      }
      if (sql.includes('FROM "batches"')) {
        return Promise.resolve([
          { id: batchId, status, sale_readiness: readiness },
        ]);
      }
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn().mockResolvedValue(1),
    batch: { update: jest.fn().mockResolvedValue({ id: batchId }) },
    batchSaleReadinessHistory: {
      create: jest.fn().mockResolvedValue({ id: "history-id" }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-id" }) },
  };
  const prisma = {
    $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
      Promise.resolve(operation(transaction)),
    ),
    idempotencyKey: { findUnique: jest.fn() },
  } as unknown as PrismaService;

  return { service: new BatchesService(prisma), prisma, transaction };
}

const owner: AuthenticatedUser = {
  id: actorId,
  name: "Owner Test",
  email: "owner@example.test",
  role: "Owner",
};
const request = {
  requestId: "request-readiness",
  socket: { remoteAddress: "127.0.0.1" },
} as never;

describe("BatchesService sale readiness", () => {
  it("updates an active batch and atomically appends history and audit", async () => {
    const { service, transaction } = createService();
    const response = await service.setSaleReadiness(
      batchId,
      { sale_readiness: "SIAP_JUAL", note: "Kondisi siap" },
      owner,
      idempotencyKey,
      request,
    );

    expect(transaction.batch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: { saleReadiness: "SIAP_JUAL" },
    });
    expect(transaction.batchSaleReadinessHistory.create).toHaveBeenCalledWith({
      data: {
        batchId,
        fromReadiness: "BELUM_SIAP",
        toReadiness: "SIAP_JUAL",
        changedBy: actorId,
        note: "Kondisi siap",
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_BATCH_SALE_READINESS",
          actorId,
          entityId: batchId,
        }),
      }),
    );
    expect(response.data).toEqual({
      batch_id: batchId,
      sale_readiness: "SIAP_JUAL",
    });
  });

  it.each(["completed", "voided"])(
    "rejects a %s batch without writing readiness or history",
    async (status) => {
      const { service, transaction } = createService(status);
      await expect(
        service.setSaleReadiness(
          batchId,
          { sale_readiness: "SIAP_JUAL" },
          owner,
          idempotencyKey,
          request,
        ),
      ).rejects.toMatchObject({ status: 422, code: "BATCH_NOT_ACTIVE" });
      expect(transaction.batch.update).not.toHaveBeenCalled();
      expect(
        transaction.batchSaleReadinessHistory.create,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-UUIDv4 idempotency key before opening a transaction", async () => {
    const { service, prisma } = createService();
    await expect(
      service.setSaleReadiness(
        batchId,
        { sale_readiness: "SIAP_JUAL" },
        owner,
        "not-a-uuid",
        request,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
