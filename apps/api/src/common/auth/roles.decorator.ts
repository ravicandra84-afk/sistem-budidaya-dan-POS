import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@pfi/shared";

export const REQUIRED_ROLES = "required_roles";

export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
