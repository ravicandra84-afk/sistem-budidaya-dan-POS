import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SpeciesService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive() {
    const species = await this.prisma.fishSpecies.findMany({
      where: { isActive: true },
      orderBy: [{ speciesName: "asc" }, { id: "asc" }],
      select: { id: true, speciesCode: true, speciesName: true },
    });

    return {
      status: "success" as const,
      message: "Daftar spesies aktif berhasil dimuat.",
      data: species.map((item) => ({
        id: item.id,
        species_code: item.speciesCode,
        species_name: item.speciesName,
      })),
    };
  }
}
