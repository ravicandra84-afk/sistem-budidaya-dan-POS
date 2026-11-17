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
export class DatabaseDependentTransactionGuard implements DependentTransactionGuard {
  async hasDependentTransactions(
    transaction: Prisma.TransactionClient,
    batchId: string,
  ): Promise<boolean> {
    const [result] = await transaction.$queryRaw<
      Array<{ has_dependent_transactions: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1 FROM "fish_sales" WHERE "batch_id" = ${batchId}::uuid
      ) AS has_dependent_transactions
    `;

    return result?.has_dependent_transactions ?? false;
  }
}
