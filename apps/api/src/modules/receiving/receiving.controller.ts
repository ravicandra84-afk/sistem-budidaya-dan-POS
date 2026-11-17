import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { Roles } from "../../common/auth/roles.decorator";
import { RolesGuard } from "../../common/auth/roles.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { ReceivingService } from "./receiving.service";
import { receiveFishSchema, voidIncomingFishSchema } from "./receiving.schemas";
import type {
  ReceiveFishInput,
  VoidIncomingFishInput,
} from "./receiving.schemas";

@Controller("fish-entries")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceivingController {
  constructor(private readonly receivingService: ReceivingService) {}

  @Post()
  @Roles("Owner", "Admin Operasional", "Kepala Budidaya")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(receiveFishSchema)) input: ReceiveFishInput,
    @Req() request: RequestWithId,
  ) {
    return this.receivingService.create(input, user, idempotencyKey, request);
  }

  @Post(":batch_id/void")
  @HttpCode(HttpStatus.OK)
  @Roles("Owner", "Admin Operasional")
  voidEntry(
    @Param("batch_id", new ZodValidationPipe(z.uuid())) batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(voidIncomingFishSchema))
    input: VoidIncomingFishInput,
    @Req() request: RequestWithId,
  ) {
    return this.receivingService.void(
      batchId,
      input,
      user,
      idempotencyKey,
      request,
    );
  }
}
