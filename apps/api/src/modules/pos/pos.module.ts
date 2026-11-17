import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import { PosController } from "./pos.controller";
import { PosService } from "./pos.service";

@Module({
  controllers: [PosController],
  providers: [PosService, JwtAuthGuard, RolesGuard],
})
export class PosModule {}
