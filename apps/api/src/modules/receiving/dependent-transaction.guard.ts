import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const DEPENDENT_TRANSACTION_GUARD = Symbol(
  "DEPENDENT_TRANSACTION_GUARD",
);

export interface DependentTransactionGuard {
  hasDependentTransactions(
    transaction: Prisma.TransactionClient,
    batchId: string,
  ): Promise<boolean>;
}

@Injectable()
export class NoDependentTransactionGuard implements DependentTransactionGuard {
  async hasDependentTransactions(): Promise<boolean> {
    return false;
  }
}
