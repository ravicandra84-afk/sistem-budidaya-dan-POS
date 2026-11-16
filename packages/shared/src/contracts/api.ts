export interface PaginationMetadata {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiSuccessEnvelope<TData, TMeta = never> {
  status: "success";
  message: string;
  data: TData;
  meta?: TMeta;
}

export interface PaginatedData<TItem> {
  items: TItem[];
  pagination: PaginationMetadata;
}

export type PaginatedApiSuccessEnvelope<TItem> = ApiSuccessEnvelope<
  PaginatedData<TItem>
>;

export interface ApiErrorEnvelope {
  status: "error";
  message: string;
  error: {
    code: string;
    details?: unknown;
  };
  meta?: {
    request_id?: string;
  };
}