import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { createUserSchema, updateUserSchema } from "./users.schemas";
import type { CreateUserInput, UpdateUserInput } from "./users.schemas";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("Owner")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ) {
    return this.usersService.create(input, actor, request);
  }

  @Patch(":id")
  update(
    @Param("id", new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
  ) {
    return this.usersService.update(id, input, actor, request);
  }
}
