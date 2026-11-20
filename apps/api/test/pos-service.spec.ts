import { PosService } from "../src/modules/pos/pos.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { ApiExceptionFilter } from "../src/common/http/api-exception.filter";
import type { ArgumentsHost } from "@nestjs/common";
import type { AuthenticatedUser } from "../src/common/auth/jwt-auth.guard";

const saleId = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const batchId = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
const actorId = "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3";

function createSaleRecord(voided = false) {
  return {
    id: saleId,
    saleCode: "PFI-SAL-20261120-001",
    createdAt: new Date("2026-11-20T03:00:00.000Z"),
    createdBy: actorId,
    batchId,
    quantity: 2,
    unitPrice: 1250n,
    totalAmount: 2500n,
    paymentMethod: "cash",
    cashReceived: 3000n,
    changeAmount: 500n,
    batch: {
      batchCode: "PFI-BCH-20261120-001",
      species: {
        id: actorId,
        speciesCode: "TEST-FISH",
        speciesName: "Test Fish",
      },
      incomingFish: { fishSize: "3-5 cm" },
    },
    creator: { id: actorId, name: "POS Tester" },
    void: voided
      ? {
          voidedAt: new Date("2026-11-20T04:00:00.000Z"),
          actor: { id: actorId, name: "POS Tester" },
        }
      : null,
  };
}

function createService() {
  const fishSale = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const fishSalePrice = {
    count: jest.fn(),
    findMany: jest.fn(),
  };
  const transaction = jest
    .fn()
    .mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  const queryRaw = jest.fn();
  const prisma = {
    fishSale,
    fishSalePrice,
    $queryRaw: queryRaw,
    $transaction: transaction,
  } as unknown as PrismaService;

  return {
    service: new PosService(prisma),
    fishSale,
    fishSalePrice,
    queryRaw,
    transaction,
  };
}

describe("PosService sales queries", () => {
  it("applies inclusive date/status filters, stable ordering, and derived VOID status", async () => {
    const { service, fishSale } = createService();
    fishSale.count.mockResolvedValue(1);
    fishSale.findMany.mockResolvedValue([createSaleRecord(true)]);
    const startDate = "2026-11-20T02:00:00.000Z";
    const endDate = "2026-11-20T05:00:00.000Z";

    const response = await service.listSales(
      {
        page: 2,
        limit: 5,
        startDate,
        endDate,
        status: "voided",
      },
      "request-sales",
    );

    const where = {
      createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
      void: { isNot: null },
    };
    expect(fishSale.count).toHaveBeenCalledWith({ where });
    expect(fishSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(response.data.items[0]).toMatchObject({
      id: saleId,
      status: "voided",
      voided_by: { id: actorId, name: "POS Tester" },
    });
    expect(response.meta).toEqual({ request_id: "request-sales" });
  });

  it("returns the derived status for sale detail and reports missing sales", async () => {
    const { service, fishSale } = createService();
    fishSale.findUnique
      .mockResolvedValueOnce(createSaleRecord())
      .mockResolvedValueOnce(null);

    const detail = await service.getSale(saleId, "request-sale-detail");
    expect(detail.data).toMatchObject({ id: saleId, status: "active" });
    expect(detail.meta).toEqual({ request_id: "request-sale-detail" });
    await expect(
      service.getSale(saleId, "request-missing-sale"),
    ).rejects.toMatchObject({
      code: "SALE_NOT_FOUND",
    });
  });

  it("rejects VOID without a UUIDv4 idempotency key before opening a transaction", async () => {
    const { service, transaction } = createService();
    const actor = {
      id: actorId,
      name: "POS Tester",
      email: "tester@example.test",
      role: "Kasir",
    } as const;
    const request = {
      requestId: "request-1",
      socket: { remoteAddress: "127.0.0.1" },
    } as const;

    await expect(
      service.voidSale(
        saleId,
        {} as never,
        actor,
        "not-a-uuid",
        request as never,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("PosService price catalog", () => {
  it("paginates and maps price items with updater identity", async () => {
    const { service, fishSalePrice } = createService();
    const createdAt = new Date("2026-11-20T03:00:00.000Z");
    const updatedAt = new Date("2026-11-20T04:00:00.000Z");
    fishSalePrice.count.mockResolvedValue(11);
    fishSalePrice.findMany.mockResolvedValue([
      {
        id: saleId,
        fishSize: "3-5 cm",
        pricePerFish: 2500n,
        createdAt,
        updatedAt,
        species: {
          id: actorId,
          speciesCode: "TEST-FISH",
          speciesName: "Test Fish",
        },
        updater: { id: actorId, name: "POS Tester" },
      },
    ]);

    const response = await service.listPrices(
      { page: 2, limit: 5 },
      "request-prices",
    );

    expect(fishSalePrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(response.data.pagination).toEqual({
      page: 2,
      limit: 5,
      totalItems: 11,
      totalPages: 3,
    });
    expect(response.data.items[0]).toMatchObject({
      id: saleId,
      species_id: actorId,
      species_code: "TEST-FISH",
      species_name: "Test Fish",
      fish_size: "3-5 cm",
      price_per_fish: 2500,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
      updated_by: { id: actorId, name: "POS Tester" },
    });
    expect(response.meta).toEqual({ request_id: "request-prices" });
  });

  it("rejects out-of-range prices before opening a database transaction", async () => {
    const { service, transaction } = createService();
    const actor: AuthenticatedUser = {
      id: actorId,
      name: "POS Tester",
      email: "tester@example.test",
      role: "Owner",
    };
    const request = {
      requestId: "request-price",
      socket: { remoteAddress: "127.0.0.1" },
    } as never;

    await expect(
      service.createPrice(
        actor,
        {
          species_id: actorId,
          fish_size: "3-5 cm",
          price_per_fish: 10_000_001,
        },
        "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4",
        request,
      ),
    ).rejects.toMatchObject({ code: "PRICE_OUT_OF_RANGE" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("PosService POS batches", () => {
  const batchRow = {
    batch_id: batchId,
    batch_code: "PFI-BCH-20261120-001",
    status: "active",
    species_id: actorId,
    species_code: "TEST-FISH",
    species_name: "Test Fish",
    fish_size: "3-5 cm",
    current_stock: 75n,
    unit_price: 2500n,
  };

  it("filters by active positive computed stock and maps nullable price", async () => {
    const { service, queryRaw } = createService();
    queryRaw
      .mockResolvedValueOnce([{ total_items: 2n }])
      .mockResolvedValueOnce([
        batchRow,
        { ...batchRow, batch_id: saleId, current_stock: 10n, unit_price: null },
      ]);

    const response = await service.listPosBatches(
      { page: 1, limit: 20 },
      "request-pos-batches",
    );

    const sql = queryRaw.mock.calls.map(([parts]) => parts.join(""));
    expect(sql[0]).toContain('"calculate_batch_stock"');
    expect(sql[1]).toContain('"batch"."status" = \'active\'');
    expect(sql[1]).toContain('"calculate_batch_stock"("batch"."id") > 0');
    expect(sql[1]).toContain('"batch"."created_at" DESC, "batch"."id" DESC');
    expect(response.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
      totalItems: 2,
      totalPages: 1,
    });
    expect(response.data.items).toEqual([
      {
        batch: {
          id: batchId,
          batch_code: "PFI-BCH-20261120-001",
          status: "active",
          current_stock: 75,
        },
        species: {
          id: actorId,
          species_code: "TEST-FISH",
          species_name: "Test Fish",
        },
        fish_size: "3-5 cm",
        unit_price: 2500,
      },
      {
        batch: {
          id: saleId,
          batch_code: "PFI-BCH-20261120-001",
          status: "active",
          current_stock: 10,
        },
        species: {
          id: actorId,
          species_code: "TEST-FISH",
          species_name: "Test Fish",
        },
        fish_size: "3-5 cm",
        unit_price: null,
      },
    ]);
    expect(response.meta).toEqual({ request_id: "request-pos-batches" });
  });

  it("refreshes batch stock and reports missing, inactive, or empty batches", async () => {
    const { service, queryRaw } = createService();
    queryRaw
      .mockResolvedValueOnce([batchRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...batchRow, status: "completed" }])
      .mockResolvedValueOnce([{ ...batchRow, current_stock: 0n }]);

    const detail = await service.getPosBatch(batchId, "request-pos-batch");
    expect(detail.data).toMatchObject({
      batch: { id: batchId, status: "active", current_stock: 75 },
      unit_price: 2500,
    });
    expect(detail.meta).toEqual({ request_id: "request-pos-batch" });
    await expect(
      service.getPosBatch(saleId, "request-missing-batch"),
    ).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
    });
    await expect(
      service.getPosBatch(saleId, "request-inactive-batch"),
    ).rejects.toMatchObject({
      code: "BATCH_NOT_ACTIVE",
    });
    await expect(
      service.getPosBatch(saleId, "request-empty-batch"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: { available_quantity: 0 },
    });
  });
});

describe("PosService receipt access", () => {
  const creator: AuthenticatedUser = {
    id: actorId,
    name: "POS Tester",
    email: "tester@example.test",
    role: "Kasir",
  };

  it("returns exactly nine receipt fields for the active sale creator", async () => {
    const { service, fishSale } = createService();
    fishSale.findUnique.mockResolvedValue(createSaleRecord());

    const response = await service.getReceipt(
      saleId,
      creator,
      "request-receipt",
    );

    expect(Object.keys(response.data)).toEqual([
      "company_name",
      "transaction_date_time",
      "species_name",
      "fish_size",
      "quantity",
      "unit_price",
      "total_payment",
      "payment_method",
      "cashier_name",
    ]);
    expect(response.data).toEqual({
      company_name: "PT. Pisciculture Farm Indonesia",
      transaction_date_time: "20/11/2026, 10.00.00 WIB",
      species_name: "Test Fish",
      fish_size: "3-5 cm",
      quantity: 2,
      unit_price: 1250,
      total_payment: 2500,
      payment_method: "cash",
      cashier_name: "POS Tester",
    });
    expect(response.meta).toEqual({ request_id: "request-receipt" });
  });

  it("denies another actor and blocks receipts for VOID sales", async () => {
    const { service, fishSale } = createService();
    fishSale.findUnique
      .mockResolvedValueOnce(createSaleRecord())
      .mockResolvedValueOnce(createSaleRecord(true));

    await expect(
      service.getReceipt(saleId, { ...creator, id: batchId }, "request-denied"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.getReceipt(saleId, creator, "request-void-receipt"),
    ).rejects.toMatchObject({
      code: "RECEIPT_NOT_AVAILABLE",
    });
  });
});

describe("ApiExceptionFilter database deadlock handling", () => {
  it("maps PostgreSQL 40P01 to a sanitized 503 lock error", () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "request-123" }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(
      {
        code: "P2010",
        meta: {
          code: "40P01",
          message: "deadlock detected while executing SELECT * FROM fish_sales",
        },
      },
      host,
    );

    expect(response.status).toHaveBeenCalledWith(503);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      status: "error",
      error: { code: "DATABASE_LOCK_TIMEOUT" },
      meta: { request_id: "request-123" },
    });
    expect(body.message).toBe("Database sedang sibuk. Silakan coba kembali.");
    expect(JSON.stringify(body)).not.toMatch(
      /deadlock|SELECT|fish_sales|40P01/,
    );
  });
});
