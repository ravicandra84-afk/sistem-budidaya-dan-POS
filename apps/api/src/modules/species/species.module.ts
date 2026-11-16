import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import { SpeciesController } from "./species.controller";
import { SpeciesService } from "./species.service";

@Module({
  controllers: [SpeciesController],
  providers: [SpeciesService, JwtAuthGuard, RolesGuard],
})
export class SpeciesModule {}
