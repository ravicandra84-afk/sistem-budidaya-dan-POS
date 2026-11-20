# POS API Contract

- Status: APPROVED — OWNER (ADR 0002)
- API version: `/api/v1`
- Timezone for business dates and receipt display: `Asia/Jakarta`
- Database target: PostgreSQL 13+

This document is normative for POS API implementation and QA. POS routes,
schemas, and errors in earlier proposal sections are superseded by this
contract. It does not authorize implementation before the approved task
sequence and explicit start instruction.

## 1. Common Contract

All routes require a verified bearer JWT except where public authentication
is explicitly defined elsewhere. Actor IDs (`created_by`, `voided_by`, and
audit actor) are derived from verified JWT claims, never from request bodies.
JSON properties use `snake_case`.

All mutating routes require:

```http
Authorization: Bearer <jwt_token>
Idempotency-Key: <UUIDv4>
Content-Type: application/json
```

The key is scoped by authenticated user, canonical endpoint, and key value.
The normalized business payload is hashed. Same key and same payload returns
the cached outcome; same key with a different payload returns
`409 IDEMPOTENCY_MISMATCH`. Validation/authentication failures before a
transaction do not consume the key. A price/stock conflict rolls back the
idempotency row. After refreshed values are confirmed, the client uses a new
key. If commit outcome is uncertain due to a network failure, retry the same
request with the same key; never automatically create a second sale.

Success envelope:

```json
{
  "status": "success",
  "message": "...",
  "data": {},
  "meta": {
    "request_id": "...",
    "idempotency_status": "executed"
  }
}
```

`idempotency_status` is `executed` or `cached` on mutations. Error envelope:

```json
{
  "status": "error",
  "message": "...",
  "error": { "code": "...", "details": {} },
  "meta": { "request_id": "..." }
}
```

`error.details` is omitted except for the explicitly safe refresh details
below. It must never contain SQL, stack traces, secrets, or infrastructure
details. List success data is `{ "items": [], "pagination": { "page": 1,
"limit": 20, "totalItems": 0, "totalPages": 0 } }`.

## 2. List Query Rules

- `page`: positive integer, default `1`.
- `limit`: integer `1..100`, default `20`.
- Default order: newest transaction first, then `id DESC` for stable ties.
- Sales `startDate`/`endDate`: ISO 8601 timestamp with explicit UTC marker or
  offset; inclusive bounds on `created_at`; `endDate` must not precede
  `startDate`.
- Sales `status`: only derived values `active` or `voided`.
- No free-text search or arbitrary sort is supported.
- POS batch lists represent current availability, so date filters are not
  accepted. Price lists accept pagination only; prices have no history.

Unknown query parameters are rejected. Numeric and timestamp parsing follows
the shared pagination validation convention.

## 3. Routes

### 3.1 Sellable Batches

`GET /api/v1/pos/batches?page={page}&limit={limit}`

Access: `Owner`, `Admin Operasional`, `Kasir`.

Returns only batches with status `active` and computed stock greater than
zero. Each item contains `batch` (`id`, `batch_code`, `status`,
`current_stock`), `species` (`id`, `species_code`, `species_name`),
`fish_size`, and `unit_price` (integer Rupiah or `null` when no catalog price
exists). A missing price blocks checkout but does not hide the batch.

`GET /api/v1/pos/batches/{batch_id}`

Access: `Owner`, `Admin Operasional`, `Kasir`. Refreshes the current stock and
current catalog price for confirmation before sale. `404 BATCH_NOT_FOUND`
if absent; `409 BATCH_NOT_ACTIVE` if not active; zero stock is reported as
`409 INSUFFICIENT_STOCK` with safe `available_quantity: 0` detail.

### 3.2 Price Catalog

`GET /api/v1/pos/prices?page={page}&limit={limit}`

Access: all POS roles. Returns `id`, species identity/name, `fish_size`,
`price_per_fish`, `created_at`, `updated_at`, and updater identity/name where
available. It does not return price history.

`POST /api/v1/pos/prices`

Access: `Owner`, `Admin Operasional`. Request:

```json
{
  "species_id": "uuid",
  "fish_size": "3-5 cm",
  "price_per_fish": 2500
}
```

Creates a price for a combination that does not exist (`201 Created`). Price
must be an integer Rupiah value from `1` through `10000000`; species must
exist. Audit action is `CREATE_SALE_PRICE`, with actor/time only and null
`old_values`/`new_values`.

`PATCH /api/v1/pos/prices/{price_id}`

Access: `Owner`, `Admin Operasional`. Request:

```json
{ "price_per_fish": 2750 }
```

Updates the current catalog price (`200 OK`). The price ID and species/size
combination are immutable. There is no `DELETE` route. Audit action is
`UPDATE_SALE_PRICE`, with actor/time only and null `old_values`/`new_values`.
Catalog mutation and audit insertion are one database transaction.

### 3.3 Create Sale

`POST /api/v1/pos/sales`

Access: `Owner`, `Admin Operasional`, `Kasir`.

Cash request:

```json
{
  "batch_id": "uuid",
  "quantity": 10,
  "expected_unit_price": 2500,
  "payment_method": "cash",
  "cash_received": 30000
}
```

Transfer request:

```json
{
  "batch_id": "uuid",
  "quantity": 10,
  "expected_unit_price": 2500,
  "payment_method": "transfer",
  "transfer_confirmed": true
}
```

`quantity` is the final positive integer quantity accepted by the cashier;
the UI must cap an over-stock entry and obtain explicit confirmation before
submitting. `expected_unit_price` is the latest refreshed and explicitly
confirmed catalog value. The backend does not trust a client total: it
rechecks batch, stock, price, and payment under the batch lock, then computes
`total_amount = quantity * unit_price` and cash change. Cash received must be
at least the total. Transfer requires `transfer_confirmed: true`; no
transfer reference is collected. Fields irrelevant to the selected payment
method are rejected.

Within one ACID transaction, the backend locks `batches` with
`SELECT ... FOR UPDATE`, locks/rechecks the price row, validates the
computed stock and active status, allocates the Jakarta daily sale number,
inserts the immutable sale and `CREATE_SALE` audit, and completes
idempotency. Sale commits before printing is attempted.

Success is `201 Created`. `data.sale` contains internal history fields
including `sale_code`, batch/species/size, quantity, snapshot price/total,
payment values, cashier, timestamp, and derived status. `data.receipt`
contains only the nine print fields defined in ADR 0002; it never includes
sale code or batch code. The receipt timestamp is displayed in
`Asia/Jakarta`.

### 3.4 Sales History and Detail

`GET /api/v1/pos/sales?page={page}&limit={limit}&startDate={iso}&endDate={iso}&status={active|voided}`

Access: all POS roles. Returns all sales, including VOID history. Each item
contains sale code, transaction timestamp, batch ID/code for internal UI,
species/size, quantity, unit price, total, payment method, creator, and
derived status. The sale code and batch code are never printed.

`GET /api/v1/pos/sales/{sale_id}`

Access: all POS roles. Returns the same sale snapshot plus VOID actor/time
when voided. A VOID does not modify the original sale.

### 3.5 Void Sale

`POST /api/v1/pos/sales/{sale_id}/void`

Access: `Owner`, `Admin Operasional`, `Kasir`. Request body is empty (`{}`);
reason is not required. Success is `200 OK`.

In one ACID transaction, lock the associated batch, verify that the sale
exists and has no VOID record, insert `fish_sale_voids`, recompute stock and
batch status, append `VOID_SALE` audit, and complete idempotency. The sale is
VOIDed once only; its history remains visible. A `voided` batch is never
reactivated.

### 3.6 Receipt Data / Reprint

`GET /api/v1/pos/sales/{sale_id}/receipt`

Only the original creator may access it, and only while the sale is not
VOID. Returns exactly these nine fields: `company_name` (`PT. Pisciculture
Farm Indonesia`), `transaction_date_time` in `Asia/Jakarta`, `species_name`,
`fish_size`, `quantity` in ekor, `unit_price`, `total_payment`,
`payment_method`, and `cashier_name`. It excludes sale number, batch code,
weight, customer data, transfer reference, VOID reason, and VOID watermark.
A print retry uses this existing receipt data and never creates a sale.

## 4. RBAC Matrix

| Operation                                    |       Owner | Admin Operasional |                   Kepala Budidaya |        Kasir |
| -------------------------------------------- | ----------: | ----------------: | --------------------------------: | -----------: |
| View POS batches, prices, sales, sale detail |       Allow |             Allow |                              Deny |        Allow |
| Create sale                                  |       Allow |             Allow |                              Deny |        Allow |
| Void sale                                    |       Allow |             Allow |                              Deny |        Allow |
| Add/update price                             |       Allow |             Allow |                              Deny |         Deny |
| Reprint own non-VOID sale                    |       Allow |             Allow |                              Deny |        Allow |
| Reprint another user's sale                  |        Deny |              Deny |                              Deny |         Deny |
| Audit log access                             | All entries |       All entries | `CREATE_ENTRY`, `VOID_ENTRY` only | Deny (`403`) |

`Kepala Budidaya` must not receive POS audit actions `CREATE_SALE`,
`VOID_SALE`, `CREATE_SALE_PRICE`, or `UPDATE_SALE_PRICE`.

For completeness, existing receiving/batch permissions remain unchanged:
Owner, Admin Operasional, and Kepala Budidaya can view batches and create
receipts; Owner and Admin Operasional can VOID receipts; Kasir has no
receiving/batch access. Master species remains outside UI/API management.

## 5. Error Contract

| HTTP | Code                      | Meaning                                                                                                                    |
| ---: | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
|  400 | `INVALID_PAYLOAD`         | Invalid/missing fields, invalid enum, bad pagination/date range, missing transfer confirmation, or invalid payment fields. |
|  400 | `INVALID_IDEMPOTENCY_KEY` | Missing or non-UUIDv4 key on mutation.                                                                                     |
|  401 | `UNAUTHORIZED`            | Missing, invalid, or expired JWT.                                                                                          |
|  403 | `FORBIDDEN`               | Role or receipt ownership is not authorized.                                                                               |
|  404 | `BATCH_NOT_FOUND`         | Batch does not exist.                                                                                                      |
|  404 | `SALE_NOT_FOUND`          | Sale does not exist.                                                                                                       |
|  404 | `PRICE_NOT_FOUND`         | Price ID does not exist for update.                                                                                        |
|  409 | `IDEMPOTENCY_MISMATCH`    | Same user/endpoint/key used with a different normalized payload.                                                           |
|  409 | `BATCH_NOT_ACTIVE`        | Batch is not active at checkout.                                                                                           |
|  409 | `PRICE_NOT_CONFIGURED`    | No catalog price exists for the batch species/size.                                                                        |
|  409 | `PRICE_CHANGED`           | Expected price differs from current catalog price; safe details include current `unit_price`.                              |
|  409 | `INSUFFICIENT_STOCK`      | Current stock is less than submitted quantity; safe details include `available_quantity`.                                  |
|  409 | `PRICE_ALREADY_EXISTS`    | POST price combination already exists; use PATCH.                                                                          |
|  409 | `SALE_ALREADY_VOIDED`     | Sale already has a VOID record.                                                                                            |
|  409 | `RECEIPT_NOT_AVAILABLE`   | Receipt belongs to a VOID sale.                                                                                            |
|  422 | `PRICE_OUT_OF_RANGE`      | Integer price is outside Rp1..Rp10,000,000.                                                                                |
|  429 | `RATE_LIMIT_EXCEEDED`     | Request rate exceeded.                                                                                                     |
|  500 | `INTERNAL_SERVER_ERROR`   | Unexpected internal failure; no implementation details exposed.                                                            |
|  503 | `DATABASE_LOCK_TIMEOUT`   | Lock wait, deadlock, or database statement timeout.                                                                        |
|  503 | `DATABASE_UNAVAILABLE`    | Database is unavailable.                                                                                                   |

Validation, authentication, and authorization failures before transaction
start do not consume idempotency keys. Required audit failures roll back the
associated business transaction. Printer failures occur after commit and
are not returned as sale failures.

## 6. QA Acceptance

Tests must cover all four roles, every route and response schema, price
missing/change, stale stock, explicit quantity confirmation in UI, cash and
transfer payment, audit rollback, same-key retry/mismatch, sale sequence
beyond 999, sale VOID exactly once, receipt ownership/VOID restrictions,
print failure without duplicate sale, and filters/pagination. PostgreSQL
tests must exercise real trigger/privilege behavior, sale-vs-sale locking,
and receiving-VOID-vs-sale locking. Re-run TC-01 through TC-32 as regression.

## 7. POS QA Test Matrix

This matrix maps the approved contract to the existing automated Phase 7
suites. A row may group assertions from one Jest test and is not necessarily
a separately named Jest test. `N/A` means the case is a schema, service-unit,
or direct database test without an HTTP request. Database state refers to
the disposable fixture; integration suites roll fixtures back or empty
`pfi_test` during teardown. No physical-printer verification is implied.

| ID        | Modul / endpoint                                                | Role & prasyarat                                                                           | Skenario uji                                                                                                                                                                                                                          | Expected HTTP / error / DB state                                                                                                                                                                                                                  | Bukti test                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-POS-01 | Shared payment contract                                         | N/A; shared package                                                                        | Metode hanya `cash`/`transfer`; error POS memuat `PRICE_CHANGED` dan `INSUFFICIENT_STOCK`.                                                                                                                                            | N/A (schema); DB unchanged.                                                                                                                                                                                                                       | `exports the approved payment methods and create-sale errors` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                                                            |
| TC-POS-02 | `POST /pos/sales` schema                                        | N/A; payload cash dan transfer valid                                                       | Terima payload tunai lengkap dan transfer dengan `transfer_confirmed: true`.                                                                                                                                                          | N/A (schema); DB unchanged.                                                                                                                                                                                                                       | `accepts cash and confirmed transfer payloads` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                                                                           |
| TC-POS-03 | `POST /pos/sales` schema                                        | N/A; payload invalid                                                                       | Tolak quantity nol, harga di atas batas, transfer belum dikonfirmasi, serta field total tambahan.                                                                                                                                     | N/A (schema; API mapping `400 INVALID_PAYLOAD`); transaksi belum dibuka, DB unchanged.                                                                                                                                                            | `rejects invalid quantities, price ranges, payment confirmation, and extra fields` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                                       |
| TC-POS-04 | `GET /pos/sales`, `POST /pos/sales/:id/void` schema             | N/A; query/body                                                                            | Validasi default pagination, tanggal/status, batas limit, dan body VOID kosong; tolak input tak valid.                                                                                                                                | N/A (schema; invalid API input `400 INVALID_PAYLOAD`); DB unchanged.                                                                                                                                                                              | `validates approved sales pagination, dates, status, and empty VOID body` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                                                |
| TC-POS-05 | `GET/POST/PATCH /pos/prices` schema                             | N/A; query/body                                                                            | Validasi pagination harga, integer Rupiah, dan payload create/update strict.                                                                                                                                                          | N/A (schema; API invalid `400 INVALID_PAYLOAD`, range service `422 PRICE_OUT_OF_RANGE`); DB unchanged.                                                                                                                                            | `validates price pagination and strict create/update payloads` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts), [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                                                                                              |
| TC-POS-06 | `GET /pos/batches` schema                                       | N/A; query                                                                                 | Terima pagination hingga 100; tolak limit >100 dan filter tanggal.                                                                                                                                                                    | N/A (schema; invalid API input `400 INVALID_PAYLOAD`); DB unchanged.                                                                                                                                                                              | `validates POS batch pagination without transaction-date filters` — [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                                                        |
| TC-POS-07 | `GET /pos/batches`                                              | Owner, Admin Operasional, Kasir; batch active/stock positif, sold-out, voided, tanpa harga | Tampilkan hanya batch aktif dengan computed stock positif; batch tanpa harga tetap tampil dengan harga null; cek pagination.                                                                                                          | `200`; tidak ada mutasi.                                                                                                                                                                                                                          | `lists only active batches with positive computed stock and paginates` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `filters by active positive computed stock and maps nullable price` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                    |
| TC-POS-08 | `GET /pos/batches/:batch_id`                                    | Tiga role POS; batch active, missing, inactive, dan stock nol                              | Refresh stock/harga; uji target hilang, status tidak aktif, dan stock habis.                                                                                                                                                          | `200`; `404 BATCH_NOT_FOUND`; `409 BATCH_NOT_ACTIVE`; `409 INSUFFICIENT_STOCK` dengan `available_quantity: 0`; DB unchanged.                                                                                                                      | `refreshes POS batch detail and applies the four-role access matrix` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `refreshes batch stock and reports missing, inactive, or empty batches` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                  |
| TC-POS-09 | `GET /pos/prices`                                               | Owner, Admin Operasional, Kasir; Kepala Budidaya ditolak                                   | Daftar harga dengan pagination dan identitas updater.                                                                                                                                                                                 | POS roles `200`; Kepala Budidaya `403 FORBIDDEN`; DB unchanged.                                                                                                                                                                                   | `lists prices for POS roles with pagination and denies Kepala Budidaya` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `paginates and maps price items with updater identity` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                |
| TC-POS-10 | `POST /pos/prices`                                              | Owner; species ada dan pasangan species/size belum memiliki harga                          | Buat harga, retry key/payload sama, verifikasi audit actor dan nilai old/new null.                                                                                                                                                    | `201`; retry `201` cached; satu harga dan satu audit `CREATE_SALE_PRICE`; tanpa duplikat.                                                                                                                                                         | `creates prices idempotently, rejects duplicates, and records CREATE audit` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                  |
| TC-POS-11 | `POST /pos/prices`                                              | Owner; kombinasi duplikat, harga invalid, atau key hilang                                  | Uji conflict kombinasi harga, batas harga, dan header idempotency.                                                                                                                                                                    | `409 PRICE_ALREADY_EXISTS`; `422 PRICE_OUT_OF_RANGE`; `400 INVALID_IDEMPOTENCY_KEY`; request gagal tidak menambah harga/audit.                                                                                                                    | `creates prices idempotently...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), [pos-schemas.spec.ts](../apps/api/test/pos-schemas.spec.ts)                                                                                                                                                                                                                                                                                |
| TC-POS-12 | `POST /pos/prices`                                              | Owner/Admin diizinkan; Kasir/Kepala Budidaya ditolak                                       | Uji matriks akses create price.                                                                                                                                                                                                       | Manager `201`; role terlarang `403 FORBIDDEN`; tidak ada harga/audit dari request terlarang.                                                                                                                                                      | `allows %s to create prices and denies Kasir/Kepala Budidaya` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                                |
| TC-POS-13 | `PATCH /pos/prices/:price_id`                                   | Owner/Admin; price ada atau tidak ada                                                      | Update, retry identik, payload mismatch, dan ID tidak ditemukan.                                                                                                                                                                      | `200`; retry `200` cached; mismatch `409 IDEMPOTENCY_MISMATCH`; missing `404 PRICE_NOT_FOUND`; satu row harga terkini dan audit `UPDATE_SALE_PRICE`.                                                                                              | `updates prices idempotently, audits UPDATE, and returns PRICE_NOT_FOUND` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                    |
| TC-POS-14 | `PATCH /pos/prices/:price_id`, `POST /pos/prices`               | Manager diizinkan; Kasir/Kepala Budidaya ditolak; audit dipaksa gagal                      | Verifikasi RBAC dan atomic rollback jika insert audit gagal pada create/update harga.                                                                                                                                                 | Role terlarang `403 FORBIDDEN`; audit failure `500 INTERNAL_SERVER_ERROR`; harga lama tetap, create tidak meninggalkan row, idempotency tidak tersimpan.                                                                                          | `allows %s to update prices...` dan `rolls back price writes and idempotency...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                             |
| TC-POS-15 | `POST /pos/sales`                                               | Owner, Admin Operasional, Kasir; Kepala Budidaya ditolak; batch/harga valid                | Uji akses create sale untuk role POS dan penolakan Kepala Budidaya.                                                                                                                                                                   | POS roles `201`; Kepala Budidaya `403 FORBIDDEN`; penolakan tidak membuat sale.                                                                                                                                                                   | `allows %s to create a cash sale...` dan `denies Kepala Budidaya...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                         |
| TC-POS-16 | `POST /pos/sales` cash                                          | Role POS; stock cukup, harga cocok, cash >= total                                          | Simpan snapshot harga/total, cash diterima, dan kembalian; verifikasi uang pas menghasilkan kembalian nol.                                                                                                                            | `201`; DB sale total sesuai perkalian, cash/change konsisten, audit `CREATE_SALE` satu kali.                                                                                                                                                      | `allows %s to create a cash sale...`, `accepts quantity one with exact cash...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `accepts cash and transfer sales...` — [pos-sales-database.spec.ts](../apps/api/test/pos-sales-database.spec.ts)                                                                                                                                                                            |
| TC-POS-17 | `POST /pos/sales` transfer                                      | Kasir; stock/harga valid, transfer dikonfirmasi                                            | Buat sale transfer tanpa field tunai/kembalian; tolak dana yang belum dikonfirmasi.                                                                                                                                                   | `201`; `cash_received` dan `change_amount` null; transfer tanpa `transfer_confirmed: true` menghasilkan `400 INVALID_PAYLOAD`, tanpa sale.                                                                                                        | `creates a fully confirmed transfer sale with no cash fields` (termasuk reject tanpa konfirmasi) — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `accepts cash and transfer sales...` — [pos-sales-database.spec.ts](../apps/api/test/pos-sales-database.spec.ts)                                                                                                                                                           |
| TC-POS-18 | `POST /pos/sales`, `POST /pos/sales/:id/void` idempotency       | Kasir; key hilang atau bukan UUIDv4                                                        | Tolak mutasi sebelum transaksi dimulai.                                                                                                                                                                                               | `400 INVALID_IDEMPOTENCY_KEY`; tidak ada sale, sequence, audit, atau idempotency row.                                                                                                                                                             | `denies Kepala Budidaya and rejects missing or invalid UUIDv4 idempotency keys` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `rejects VOID without a UUIDv4 idempotency key...` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                            |
| TC-POS-19 | `POST /pos/sales` missing price                                 | Kasir; batch aktif/stock cukup, catalog price kosong                                       | Cegah checkout tanpa harga katalog.                                                                                                                                                                                                   | `409 PRICE_NOT_CONFIGURED`; sale dan idempotency row tidak tersimpan.                                                                                                                                                                             | `returns safe errors for missing price, stale price, and insufficient cash` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                  |
| TC-POS-20 | `POST /pos/sales` stale price; `GET /pos/batches/:id` stock nol | Kasir; harga berubah setelah refresh atau batch kosong                                     | Verifikasi detail aman untuk refresh harga dan stock, termasuk quantity yang melampaui stock saat commit.                                                                                                                             | `409 PRICE_CHANGED` dengan `unit_price` aman; stok nol `409 INSUFFICIENT_STOCK` dengan available `0`; quantity berlebih `409 INSUFFICIENT_STOCK` dengan stock aman; tidak ada sale.                                                               | `returns safe errors...`, `accepts quantity one with exact cash and rejects quantity beyond current stock` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `refreshes batch stock...` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                         |
| TC-POS-21 | `POST /pos/sales` cash kurang                                   | Kasir; batch/harga valid, cash < total                                                     | Tolak pembayaran tunai kurang dan pastikan error tidak membocorkan detail DB.                                                                                                                                                         | `400 INVALID_PAYLOAD`; tidak ada sale/sequence/audit/idempotency yang committed.                                                                                                                                                                  | `returns safe errors for missing price, stale price, and insufficient cash` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                                  |
| TC-POS-22 | `POST /pos/sales` audit atomicity                               | Kasir; trigger test menggagalkan `CREATE_SALE` audit                                       | Pastikan audit failure membatalkan seluruh transaksi.                                                                                                                                                                                 | `500 INTERNAL_SERVER_ERROR` tersanitasi; nol sale, sequence kembali, dan nol idempotency row.                                                                                                                                                     | `rolls back sale, sequence, and idempotency when required audit insertion fails` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                                                                             |
| TC-POS-23 | `POST /pos/sales` idempotency dan daily sequence                | Owner/Kasir; retry valid dan sequence disiapkan pada 999                                   | Retry key/payload identik, payload mismatch, dan alokasikan transaksi berikutnya setelah 999.                                                                                                                                         | Retry identik `201` cached dan satu sale; mismatch `409 IDEMPOTENCY_MISMATCH`; `last_number` menjadi 1000 dan kode sale berakhiran `-1000`.                                                                                                       | `returns cached response only for the same key and payload` dan `allocates sale numbers beyond the minimum three-digit sequence` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts)                                                                                                                                                                                                                                             |
| TC-POS-24 | `GET /pos/sales`                                                | Owner; sale aktif/VOID dengan timestamp                                                    | Uji pagination, inclusive time bounds, filter status, urutan, dan status filter invalid.                                                                                                                                              | Valid `200`; status invalid `400 INVALID_PAYLOAD`; DB unchanged.                                                                                                                                                                                  | `lists sales with ADR pagination...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `applies inclusive date/status filters...` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                                                               |
| TC-POS-25 | `GET /pos/sales/:sale_id`                                       | POS roles; Kepala Budidaya ditolak; sale aktif/VOID/missing                                | Baca detail dan status turunan, termasuk target tidak ditemukan dan RBAC.                                                                                                                                                             | POS roles `200`; missing `404 SALE_NOT_FOUND`; Kepala Budidaya `403 FORBIDDEN`; DB unchanged.                                                                                                                                                     | `returns sale detail...`, `allows POS roles to list, view and VOID...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                                                                          |
| TC-POS-26 | `GET /pos/sales/:sale_id/receipt`                               | Pembuat sale aktif; role POS                                                               | Kembalikan tepat sembilan field resmi, nama perusahaan, waktu WIB, tanpa sale/batch code atau berat.                                                                                                                                  | `200`; tepat sembilan key; DB unchanged dan tidak ada sale baru.                                                                                                                                                                                  | `allows only the active sale creator...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `returns exactly nine receipt fields...` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                                                             |
| TC-POS-27 | `GET /pos/sales/:sale_id/receipt`                               | Bukan pembuat atau sale sudah VOID                                                         | Tolak akses lintas user dan cetak ulang transaksi VOID.                                                                                                                                                                               | Bukan pembuat `403 FORBIDDEN`; sale VOID `409 RECEIPT_NOT_AVAILABLE`; DB unchanged.                                                                                                                                                               | `allows only the active sale creator...` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `denies another actor and blocks receipts for VOID sales` — [pos-service.spec.ts](../apps/api/test/pos-service.spec.ts)                                                                                                                                                                                                            |
| TC-POS-28 | PostgreSQL `fish_sales` constraints                             | Direct DB fixture; cash/transfer valid dan payload invalid                                 | Uji quantity/harga/total/payment fields/sale code constraints.                                                                                                                                                                        | N/A (DB integration); valid cash/transfer diterima di fixture; invalid writes ditolak dan di-rollback ke savepoint; fixture tidak persisten.                                                                                                      | `accepts cash and transfer sales...` dan `rejects invalid sale quantity...` — [pos-sales-database.spec.ts](../apps/api/test/pos-sales-database.spec.ts)                                                                                                                                                                                                                                                                                                |
| TC-POS-29 | PostgreSQL `fish_sale_voids` / append-only                      | Direct DB fixture; sale valid                                                              | Pastikan satu VOID per sale dan UPDATE/DELETE sale/VOID ditolak.                                                                                                                                                                      | N/A (DB integration); duplicate/UPDATE/DELETE gagal; transaksi fixture di-rollback.                                                                                                                                                               | `permits one VOID and blocks updates or deletes of sale and VOID history` — [pos-sales-database.spec.ts](../apps/api/test/pos-sales-database.spec.ts)                                                                                                                                                                                                                                                                                                  |
| TC-POS-30 | Computed stock, lock, receiving guard, runtime grants           | PostgreSQL; batch, sale dan concurrent writer fixture                                      | Uji `active -> completed -> active`, batch voided terkunci, dua Kasir HTTP bersamaan tanpa overselling, concurrent runtime insert, receiving VOID tetap terblokir setelah sale VOID, race sale-vs-receiving VOID, dan grants runtime. | API: satu request `201`, request kedua `409 INSUFFICIENT_STOCK`, stock tidak negatif; DB: satu writer menang; dependent receiving VOID `HAS_DEPENDENT_TRANSACTIONS`; runtime tidak punya schema CREATE atau UPDATE/DELETE pada histori sale/VOID. | `serializes two Kasir HTTP sales on one batch without overselling` — [pos-sales-api.e2e.spec.ts](../apps/api/test/pos-sales-api.e2e.spec.ts), `recalculates stock...`, `rejects sale on voided batches...`, `prevents two concurrent runtime sales...`, `keeps sales as receiving-VOID dependencies...`, `serializes receiving VOID and sale...`, `grants runtime only...` — [pos-sales-database.spec.ts](../apps/api/test/pos-sales-database.spec.ts) |

Execution snapshot: on 2026-11-20, `RUN_V45_DB_TESTS=1 npm run test
--workspace @pfi/api -- --runInBand` completed with 14/14 suites and 176/176
tests passing, including TC-01 through TC-32 and the P9-04 API concurrency,
stock-boundary, and transfer-confirmation assertions. This snapshot covers the
automated suites on disposable `pfi_test`; it does not constitute physical
printer verification.

Coverage boundary: the 176 passing API tests do not verify frontend quantity
capping/confirmation, print-failure UX, physical 58/80 mm output, or device
compatibility. Sequence expansion to 1000 is covered by the cited POS E2E
assertion. Quantity confirmation belongs to PG-07 QA; print behavior and
physical output are deferred to the Phase 8/9 activities in
`implementation_plan.md`. Do not treat the passing suite count as evidence
for those unexecuted scenarios.
