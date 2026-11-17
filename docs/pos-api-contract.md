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
VOID. Returns exactly: company name, Jakarta-local date/time, species, fish
size, quantity in ekor, price per fish, total payment, payment method, and
cashier name. It excludes sale number, batch code, weight, customer data,
transfer reference, VOID reason, and VOID watermark. A print retry uses this
existing receipt data and never creates a sale.

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
