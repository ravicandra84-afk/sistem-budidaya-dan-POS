import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { POS_ROLES, createSaleSchema, posSalesListQuerySchema, voidSaleSchema } from "@pfi/shared";
import type {
  CreateSaleInput,
  PosSalesListQuery,
  VoidSaleInput,
} from "@pfi/shared";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { PosService } from "./pos.service";
import { z } from "zod";

@Controller("pos/sales")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get()
  @Roles(...POS_ROLES)
  listSales(
    @Query(new ZodValidationPipe(posSalesListQuerySchema))
    query: PosSalesListQuery,
  ) {
    return this.posService.listSales(query);
  }

  @Post()
  @Roles(...POS_ROLES)
  createSale(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSaleSchema)) input: CreateSaleInput,
    @Req() request: RequestWithId,
  ) {
    return this.posService.createSale(user, input, idempotencyKey, request);
  }

  @Get(":sale_id")
  @Roles(...POS_ROLES)
  getSale(
    @Param("sale_id", new ZodValidationPipe(z.uuid())) saleId: string,
  ) {
    return this.posService.getSale(saleId);
  }

  @Post(":sale_id/void")
  @HttpCode(HttpStatus.OK)
  @Roles(...POS_ROLES)
  voidSale(
    @Param("sale_id", new ZodValidationPipe(z.uuid())) saleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(voidSaleSchema)) input: Record<string, never>,
    @Req() request: RequestWithId,
  ) {
    return this.posService.voidSale(saleId, input, user, idempotencyKey, request);
  }
}