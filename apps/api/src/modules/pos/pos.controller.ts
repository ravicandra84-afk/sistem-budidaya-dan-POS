import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  PRICE_MANAGEMENT_ROLES,
  POS_ROLES,
  createSalePriceSchema,
  createSaleSchema,
  posBatchesListQuerySchema,
  posPricesListQuerySchema,
  posSalesListQuerySchema,
  updateSalePriceSchema,
  voidSaleSchema,
} from "@pfi/shared";
import type {
  CreateSalePriceInput,
  CreateSaleInput,
  PosBatchesListQuery,
  PosPricesListQuery,
  PosSalesListQuery,
  UpdateSalePriceInput,
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
    @Req() request: RequestWithId,
  ) {
    return this.posService.listSales(query, request.requestId);
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
    @Req() request: RequestWithId,
  ) {
    return this.posService.getSale(saleId, request.requestId);
  }

  @Get(":sale_id/receipt")
  @Roles(...POS_ROLES)
  getReceipt(
    @Param("sale_id", new ZodValidationPipe(z.uuid())) saleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
  ) {
    return this.posService.getReceipt(saleId, user, request.requestId);
  }

  @Post(":sale_id/void")
  @HttpCode(HttpStatus.OK)
  @Roles(...POS_ROLES)
  voidSale(
    @Param("sale_id", new ZodValidationPipe(z.uuid())) saleId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(voidSaleSchema)) input: VoidSaleInput,
    @Req() request: RequestWithId,
  ) {
    return this.posService.voidSale(
      saleId,
      input,
      user,
      idempotencyKey,
      request,
    );
  }
}

@Controller("pos/prices")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosPricesController {
  constructor(private readonly posService: PosService) {}

  @Get()
  @Roles(...POS_ROLES)
  listPrices(
    @Query(new ZodValidationPipe(posPricesListQuerySchema))
    query: PosPricesListQuery,
    @Req() request: RequestWithId,
  ) {
    return this.posService.listPrices(query, request.requestId);
  }

  @Post()
  @Roles(...PRICE_MANAGEMENT_ROLES)
  createPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createSalePriceSchema))
    input: CreateSalePriceInput,
    @Req() request: RequestWithId,
  ) {
    return this.posService.createPrice(user, input, idempotencyKey, request);
  }

  @Patch(":price_id")
  @Roles(...PRICE_MANAGEMENT_ROLES)
  updatePrice(
    @Param("price_id", new ZodValidationPipe(z.uuid())) priceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(updateSalePriceSchema))
    input: UpdateSalePriceInput,
    @Req() request: RequestWithId,
  ) {
    return this.posService.updatePrice(
      priceId,
      user,
      input,
      idempotencyKey,
      request,
    );
  }
}

@Controller("pos/batches")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosBatchesController {
  constructor(private readonly posService: PosService) {}

  @Get()
  @Roles(...POS_ROLES)
  listBatches(
    @Query(new ZodValidationPipe(posBatchesListQuerySchema))
    query: PosBatchesListQuery,
    @Req() request: RequestWithId,
  ) {
    return this.posService.listPosBatches(query, request.requestId);
  }

  @Get(":batch_id")
  @Roles(...POS_ROLES)
  getBatch(
    @Param("batch_id", new ZodValidationPipe(z.uuid())) batchId: string,
    @Req() request: RequestWithId,
  ) {
    return this.posService.getPosBatch(batchId, request.requestId);
  }
}
