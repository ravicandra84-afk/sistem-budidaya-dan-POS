import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { loadApiEnvironment } from "../../config/env";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const environment = loadApiEnvironment();

@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: environment.RATE_LIMIT_WINDOW_MS,
        limit: environment.RATE_LIMIT_MAX_REQUESTS,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
