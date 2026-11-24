export type SaleReadiness = "BELUM_SIAP" | "SIAP_JUAL";
export type ProductTrackingMode = "BATCH_TRACKED" | "NON_BATCH";

export interface ProductCategory {
  id: string;
  name: string;
  code: string;
  requires_batch: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CatalogProduct {
  id: string;
  category_id: string;
  category_name: string;
  sku: string;
  name: string;
  tracking_mode: ProductTrackingMode;
  species: string | null;
  size_label: string | null;
  unit: string;
  unit_price: number;
  stock_quantity: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SellableBatch {
  id: string;
  batch_code: string;
  current_stock: number;
  species_name: string;
  size_label: string;
}

export interface SellableProduct extends CatalogProduct {
  stock_quantity: number | null;
  batches: SellableBatch[];
}

export interface SaleReadinessHistory {
  id: string;
  from_readiness: SaleReadiness | null;
  to_readiness: SaleReadiness;
  changed_by: { id: string; name: string };
  note: string | null;
  created_at: string;
}
