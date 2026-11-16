import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { SpeciesService } from "./species.service";

@Controller("fish-species")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("Owner", "Admin Operasional", "Kepala Budidaya")
export class SpeciesController {
  constructor(private readonly speciesService: SpeciesService) {}

  @Get()
  listActive() {
    return this.speciesService.listActive();
  }
}
