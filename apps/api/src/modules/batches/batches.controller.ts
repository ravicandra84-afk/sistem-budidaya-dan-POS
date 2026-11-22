import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { batchListQuerySchema } from "@pfi/shared";
import type { BatchListQuery } from "@pfi/shared";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { BatchesService } from "./batches.service";
import {
  saleReadinessInputSchema,
  type SaleReadinessInput,
} from "./batches.schemas";

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

  @Patch(":id/sale-readiness")
  @Roles("Owner", "Kepala Budidaya")
  setSaleReadiness(
    @Param("id", new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(saleReadinessInputSchema))
    input: SaleReadinessInput,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.batchesService.setSaleReadiness(
      id,
      input,
      user,
      idempotencyKey,
      request,
    );
  }
}
