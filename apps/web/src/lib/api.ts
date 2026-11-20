export interface ApiEnvelope<TData> {
  status: "success";
  message: string;
  data: TData;
  meta?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required.");
}

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  token?: string;
  headers?: HeadersInit;
};

export async function apiRequest<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<TData>> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(
      "Layanan tidak dapat dijangkau. Periksa koneksi lalu coba lagi.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    error?: { code?: string; details?: Record<string, unknown> };
    data?: TData;
    status?: "success";
    meta?: Record<string, unknown>;
  } | null;

  if (!response.ok || !payload || payload.status !== "success") {
    if (
      response.status === 401 &&
      options.token &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event("pfi:unauthorized"));
    }
    throw new ApiClientError(
      payload?.message ?? "Permintaan tidak dapat diproses.",
      response.status,
      payload?.error?.code ?? "INVALID_RESPONSE",
      payload?.error?.details,
    );
  }

  return payload as ApiEnvelope<TData>;
}
