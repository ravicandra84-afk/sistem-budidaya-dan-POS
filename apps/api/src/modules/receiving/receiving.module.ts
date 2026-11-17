import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RolesGuard } from "../../common/auth/roles.guard";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";
import {
  DEPENDENT_TRANSACTION_GUARD,
  NoDependentTransactionGuard,
} from "./dependent-transaction.guard";

@Module({
  controllers: [ReceivingController],
  providers: [
    ReceivingService,
    JwtAuthGuard,
    RolesGuard,
    {
      provide: DEPENDENT_TRANSACTION_GUARD,
      useClass: NoDependentTransactionGuard,
    },
  ],
})
export class ReceivingModule {}
