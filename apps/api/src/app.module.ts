import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RequestIdMiddleware } from "./common/http/request-id.middleware";
import { AuditModule } from "./modules/audit/audit.module";
import { BatchesModule } from "./modules/batches/batches.module";
import { ReceivingModule } from "./modules/receiving/receiving.module";
import { SpeciesModule } from "./modules/species/species.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    SpeciesModule,
    ReceivingModule,
    BatchesModule,
    AuditModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
