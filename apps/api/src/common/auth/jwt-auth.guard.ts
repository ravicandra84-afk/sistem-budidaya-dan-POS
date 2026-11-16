import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { UserRole } from "@pfi/shared";
import type { Request } from "express";
import * as jwt from "jsonwebtoken";
import { loadApiEnvironment } from "../../config/env";
import { ApiException } from "../http/api-exception";
import { PrismaService } from "../../modules/prisma/prisma.service";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new ApiException(401, "UNAUTHORIZED", "Autentikasi diperlukan.");
    }

    const environment = loadApiEnvironment();
    let payload: string | jwt.JwtPayload;

    try {
      payload = jwt.verify(token, environment.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: environment.JWT_ISSUER,
        audience: environment.JWT_AUDIENCE,
      });
    } catch {
      throw new ApiException(
        401,
        "UNAUTHORIZED",
        "Token tidak valid atau kedaluwarsa.",
      );
    }

    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (
      !user?.isActive ||
      !["Owner", "Admin Operasional", "Kepala Budidaya"].includes(user.role)
    ) {
      throw new ApiException(
        401,
        "UNAUTHORIZED",
        "Token tidak valid atau kedaluwarsa.",
      );
    }

    request.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
    };

    return true;
  }
}
