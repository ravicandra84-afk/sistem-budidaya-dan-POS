import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BatchListQuery } from "@pfi/shared";
import { ApiException } from "../../common/http/api-exception";
import { PrismaService } from "../prisma/prisma.service";
import { calculateBatchStock } from "./batch-stock";

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BatchListQuery) {
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
      ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
    };
    const where: Prisma.BatchWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [totalItems, batches] = await this.prisma.$transaction([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          species: {
            select: { id: true, speciesCode: true, speciesName: true },
          },
          incomingFish: { include: { void: { select: { id: true } } } },
        },
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar batch berhasil dimuat.",
      data: {
        items: batches.map((batch) => ({
          batch: {
            id: batch.id,
            batch_code: batch.batchCode,
            status: batch.status,
            current_stock: calculateBatchStock({
              receivedQuantity: batch.incomingFish?.quantity ?? 0,
              receiptVoided: batch.incomingFish?.void !== null,
            }),
            created_at: batch.createdAt.toISOString(),
          },
          species: {
            id: batch.species.id,
            species_code: batch.species.speciesCode,
            species_name: batch.species.speciesName,
          },
          incoming_fish: batch.incomingFish
            ? this.mapIncomingFish(batch.incomingFish)
            : null,
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

  async getById(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        species: { select: { id: true, speciesCode: true, speciesName: true } },
        incomingFish: { include: { void: { select: { id: true } } } },
      },
    });
    if (!batch)
      throw new ApiException(404, "BATCH_NOT_FOUND", "Batch tidak ditemukan.");

    return {
      status: "success" as const,
      message: "Detail batch berhasil dimuat.",
      data: {
        batch: {
          id: batch.id,
          batch_code: batch.batchCode,
          status: batch.status,
          current_stock: calculateBatchStock({
            receivedQuantity: batch.incomingFish?.quantity ?? 0,
            receiptVoided: batch.incomingFish?.void !== null,
          }),
          created_at: batch.createdAt.toISOString(),
        },
        species: {
          id: batch.species.id,
          species_code: batch.species.speciesCode,
          species_name: batch.species.speciesName,
        },
        incoming_fish: batch.incomingFish
          ? this.mapIncomingFish(batch.incomingFish)
          : null,
      },
    };
  }

  private mapIncomingFish(
    incomingFish: Prisma.IncomingFishGetPayload<{
      include: { void: { select: { id: true } } };
    }>,
  ) {
    return {
      id: incomingFish.id,
      entry_date: incomingFish.entryDate.toISOString().slice(0, 10),
      quantity: incomingFish.quantity,
      purchase_capital: incomingFish.purchaseCapital.toFixed(2),
      shipping_capital: incomingFish.shippingCapital.toFixed(2),
      weight_sample_per_500:
        incomingFish.weightSamplePer500?.toFixed(2) ?? null,
      fish_size: incomingFish.fishSize,
      created_at: incomingFish.createdAt.toISOString(),
      voided: incomingFish.void !== null,
    };
  }
}
