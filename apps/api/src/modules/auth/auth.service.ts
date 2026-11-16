import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { ApiEnvironment, loadApiEnvironment } from "../../config/env";
import { ApiException } from "../../common/http/api-exception";
import { PrismaService } from "../prisma/prisma.service";
import { LoginInput } from "./auth.schemas";

@Injectable()
export class AuthService {
  private readonly environment: ApiEnvironment;
  private readonly dummyPasswordHash: string;

  constructor(private readonly prisma: PrismaService) {
    this.environment = loadApiEnvironment();
    this.dummyPasswordHash = bcrypt.hashSync(
      randomBytes(32).toString("hex"),
      this.environment.BCRYPT_SALT_ROUNDS,
    );
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });

    const passwordMatches = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? this.dummyPasswordHash,
    );

    if (!user || !passwordMatches || !user.isActive) {
      throw new ApiException(
        401,
        "UNAUTHORIZED",
        "Email atau kata sandi tidak valid.",
      );
    }

    const accessToken = jwt.sign(
      { role: user.role },
      this.environment.JWT_SECRET,
      {
        algorithm: "HS256",
        audience: this.environment.JWT_AUDIENCE,
        expiresIn: this.environment.JWT_EXPIRES_IN as NonNullable<
          jwt.SignOptions["expiresIn"]
        >,
        issuer: this.environment.JWT_ISSUER,
        subject: user.id,
      },
    );

    return {
      status: "success" as const,
      message: "Login berhasil.",
      data: {
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: this.environment.JWT_EXPIRES_IN,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    };
  }
}
