import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";

@Module({
  controllers: [ReceivingController],
  providers: [ReceivingService, JwtAuthGuard, RolesGuard],
})
export class ReceivingModule {}
