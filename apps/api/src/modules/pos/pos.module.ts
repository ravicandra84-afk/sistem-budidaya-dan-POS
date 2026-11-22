import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import {
  PosBatchesController,
  PosController,
  PosPricesController,
  V46SalesController,
} from "./pos.controller";
import { PosService } from "./pos.service";
import {
  PosCategoriesController,
  PosProductsController,
  PosSellableCatalogController,
} from "./pos-catalog.controller";
import { PosCatalogService } from "./pos-catalog.service";

@Module({
  controllers: [
    PosController,
    V46SalesController,
    PosPricesController,
    PosBatchesController,
    PosCategoriesController,
    PosProductsController,
    PosSellableCatalogController,
  ],
  providers: [PosService, PosCatalogService, JwtAuthGuard, RolesGuard],
})
export class PosModule {}
