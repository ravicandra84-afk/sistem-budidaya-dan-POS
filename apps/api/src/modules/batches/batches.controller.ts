import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { batchListQuerySchema } from "@pfi/shared";
import type { BatchListQuery } from "@pfi/shared";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { BatchesService } from "./batches.service";

@Controller("batches")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("Owner", "Admin Operasional", "Kepala Budidaya")
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(batchListQuerySchema)) query: BatchListQuery,
  ) {
    return this.batchesService.list(query);
  }

  @Get(":id")
  getById(@Param("id", new ZodValidationPipe(z.uuid())) id: string) {
    return this.batchesService.getById(id);
  }
}
