import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import { BatchesController } from "./batches.controller";
import { BatchesService } from "./batches.service";

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, JwtAuthGuard, RolesGuard],
})
export class BatchesModule {}
