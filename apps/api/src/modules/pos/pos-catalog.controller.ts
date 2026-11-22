import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  PRICE_MANAGEMENT_ROLES,
  USER_ROLES,
  createProductCategorySchema,
  createProductSchema,
  productCatalogListQuerySchema,
  updateProductCategorySchema,
  updateProductSchema,
} from "@pfi/shared";
import type {
  CreateProductCategoryInput,
  CreateProductInput,
  ProductCatalogListQuery,
  UpdateProductCategoryInput,
  UpdateProductInput,
} from "@pfi/shared";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { PosCatalogService } from "./pos-catalog.service";

@Controller("pos/categories")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosCategoriesController {
  constructor(private readonly catalogService: PosCatalogService) {}

  @Get()
  @Roles(...USER_ROLES)
  list(
    @Query(new ZodValidationPipe(productCatalogListQuerySchema))
    query: ProductCatalogListQuery,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.listCategories(query, request.requestId);
  }

  @Post()
  @Roles(...PRICE_MANAGEMENT_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createProductCategorySchema))
    input: CreateProductCategoryInput,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.createCategory(
      user,
      input,
      idempotencyKey,
      request,
    );
  }

  @Patch(":category_id")
  @Roles(...PRICE_MANAGEMENT_ROLES)
  update(
    @Param("category_id", new ZodValidationPipe(z.uuid())) categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(updateProductCategorySchema))
    input: UpdateProductCategoryInput,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.updateCategory(
      categoryId,
      user,
      input,
      idempotencyKey,
      request,
    );
  }
}

@Controller("pos/products")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosProductsController {
  constructor(private readonly catalogService: PosCatalogService) {}

  @Get()
  @Roles(...USER_ROLES)
  list(
    @Query(new ZodValidationPipe(productCatalogListQuerySchema))
    query: ProductCatalogListQuery,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.listProducts(query, request.requestId);
  }

  @Post()
  @Roles(...PRICE_MANAGEMENT_ROLES)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createProductSchema)) input: CreateProductInput,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.createProduct(
      user,
      input,
      idempotencyKey,
      request,
    );
  }

  @Patch(":product_id")
  @Roles(...PRICE_MANAGEMENT_ROLES)
  update(
    @Param("product_id", new ZodValidationPipe(z.uuid())) productId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(updateProductSchema)) input: UpdateProductInput,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.updateProduct(
      productId,
      user,
      input,
      idempotencyKey,
      request,
    );
  }

  @Delete(":product_id")
  @HttpCode(HttpStatus.OK)
  @Roles(...PRICE_MANAGEMENT_ROLES)
  archive(
    @Param("product_id", new ZodValidationPipe(z.uuid())) productId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.catalogService.archiveProduct(
      productId,
      user,
      idempotencyKey,
      request,
    );
  }
}

@Controller("pos/catalog")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosSellableCatalogController {
  constructor(private readonly catalogService: PosCatalogService) {}

  @Get()
  @Roles(...USER_ROLES)
  list(@Req() request: RequestWithId) {
    return this.catalogService.getSellableCatalog(request.requestId);
  }
}
