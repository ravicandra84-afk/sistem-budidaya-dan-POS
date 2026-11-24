import type { BatchStatus } from "@pfi/shared";

export interface SpeciesItem {
  id: string;
  species_code: string;
  species_name: string;
}

export interface IncomingFishItem {
  id: string;
  entry_date: string;
  quantity: number;
  purchase_capital: string;
  shipping_capital: string;
  weight_sample_per_500: string | null;
  fish_size: string;
  created_at: string;
  voided: boolean;
}

export interface BatchReadinessHistory {
  id: string;
  from_readiness: "BELUM_SIAP" | "SIAP_JUAL" | null;
  to_readiness: "BELUM_SIAP" | "SIAP_JUAL";
  changed_by: { id: string; name: string };
  note: string | null;
  created_at: string;
}

export interface BatchItem {
  batch: {
    id: string;
    batch_code: string;
    status: BatchStatus;
    sale_readiness: "BELUM_SIAP" | "SIAP_JUAL";
    current_stock: number;
    created_at: string;
  };
  species: SpeciesItem;
  incoming_fish: IncomingFishItem | null;
  sale_readiness_histories: BatchReadinessHistory[];
}

export interface PaginationData<TItem> {
  items: TItem[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface AuditEntry {
  id: string;
  request_id: string;
  actor: { id: string; name: string };
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: unknown;
  new_values: unknown;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}
