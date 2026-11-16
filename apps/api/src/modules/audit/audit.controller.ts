import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { AuditService } from "./audit.service";
import { auditListQuerySchema } from "./audit.schemas";
import type { PaginationQuery } from "@pfi/shared";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("Owner", "Admin Operasional", "Kepala Budidaya")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(auditListQuerySchema)) query: PaginationQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditService.list(query, user.role);
  }
}
