export type BatchStockMovements = {
  receivedQuantity: number;
  validSalesQuantity?: number;
  validMortalityQuantity?: number;
  receiptVoided?: boolean;
};

export function calculateBatchStock({
  receivedQuantity,
  validSalesQuantity = 0,
  validMortalityQuantity = 0,
  receiptVoided = false,
}: BatchStockMovements): number {
  if (receiptVoided) return 0;
  return receivedQuantity - validSalesQuantity - validMortalityQuantity;
}

export function canCompleteBatch(stock: number): boolean {
  return stock === 0;
}
