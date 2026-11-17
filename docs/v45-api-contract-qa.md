# Kontrak API V4.5 untuk QA

| Item              | Nilai                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Task              | P1-02 - Review dan lengkapi kontrak API V4.5                                                  |
| Cakupan           | Auth, spesies, batch, penerimaan, VOID penerimaan, audit log                                  |
| Format            | Markdown, dipilih agar kontrak bisa direview dan digunakan QA tanpa generator/dependency baru |
| Sumber            | Master Blueprint V4.5, PRD, ADR 0001, dan perilaku implementasi API yang ada                  |
| Status verifikasi | Spesifikasi disusun dari source; belum merupakan hasil eksekusi test QA                       |

## Status dan Prioritas Sumber

- Endpoint dan payload mutasi penerimaan mengikuti kontrak `LOCKED — V4.5` pada Master Blueprint.
- Endpoint baca dan login yang tidak dirinci lengkap dalam blueprint didokumentasikan sesuai route, schema, service, dan test saat ini. Detail tersebut adalah kontrak implementasi yang siap diuji, bukan perubahan terhadap aturan bisnis.
- Blueprint §2.3 memuat keputusan Owner terbaru tertanggal 2026-11-17: `Owner` dan `Admin Operasional` boleh melakukan VOID. Daftar role lama masih tertinggal di Blueprint §§4.4, 4.5, dan 5.2 serta tabel PRD; implementasi mengikuti keputusan terbaru.
- Error `HAS_DEPENDENT_TRANSACTIONS` tetap merupakan bagian kontrak, tetapi sumber transaksi turunannya belum tersedia pada MVP. Perilaku tersebut tidak dapat diverifikasi hingga modul terkait disetujui dan ada.
- Role V4.5 adalah `Owner`, `Admin Operasional`, dan `Kepala Budidaya`. `Kasir` dan endpoint POS berada di luar kontrak ini.

## Konvensi HTTP dan Envelope

Base path API adalah `/api/v1`. Body request/response menggunakan JSON UTF-8. Nama header HTTP tidak peka huruf besar-kecil.

### Header

| Header            | Ketentuan                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization`   | Wajib pada semua endpoint kecuali `POST /auth/login`. Format `Bearer <access_token>`. Token harus valid, belum kedaluwarsa, diterbitkan oleh issuer dan audience yang dikonfigurasi, serta terkait akun aktif.                |
| `Idempotency-Key` | Wajib hanya untuk `POST /fish-entries` dan `POST /fish-entries/{batch_id}/void`. Harus UUIDv4. Scope unik: user + endpoint + key. Payload bisnis identik mengembalikan hasil cached; key sama dengan payload berbeda ditolak. |
| `Content-Type`    | Wajib `application/json` untuk request yang mengirim body (`POST /auth/login`, pembuatan penerimaan, dan VOID). Tidak diperlukan untuk GET.                                                                                   |
| `X-Request-Id`    | Response header yang diterbitkan server pada setiap request. Error body dan respons mutasi menyertakan `meta.request_id`; retry idempotent memperoleh request ID baru.                                                        |

`Accept: application/json` boleh dikirim, tetapi bukan syarat autentikasi atau idempotency tersendiri.

### Envelope Sukses

Endpoint sukses memakai bentuk berikut. `meta` hanya ada bila endpoint membutuhkannya, misalnya untuk idempotency.

```json
{
  "status": "success",
  "message": "...",
  "data": {},
  "meta": {
    "request_id": "<uuid>"
  }
}
```

### Envelope Error

Semua error menggunakan bentuk tersanitasi berikut. `details`, SQL, stack trace, token, dan kredensial tidak dikirim.

```json
{
  "status": "error",
  "message": "Pesan aman untuk pengguna.",
  "error": {
    "code": "INVALID_PAYLOAD"
  },
  "meta": {
    "request_id": "<uuid>"
  }
}
```

## Daftar Endpoint

| Method dan path                             | Auth / role                                    | Sukses | Header khusus                                      |
| ------------------------------------------- | ---------------------------------------------- | ------ | -------------------------------------------------- |
| `POST /api/v1/auth/login`                   | Publik; rate limit aktif                       | `200`  | `Content-Type`                                     |
| `GET /api/v1/fish-species`                  | JWT; Owner, Admin Operasional, Kepala Budidaya | `200`  | `Authorization`                                    |
| `GET /api/v1/batches`                       | JWT; Owner, Admin Operasional, Kepala Budidaya | `200`  | `Authorization`                                    |
| `GET /api/v1/batches/{id}`                  | JWT; Owner, Admin Operasional, Kepala Budidaya | `200`  | `Authorization`                                    |
| `POST /api/v1/fish-entries`                 | JWT; Owner, Admin Operasional, Kepala Budidaya | `201`  | `Authorization`, `Idempotency-Key`, `Content-Type` |
| `POST /api/v1/fish-entries/{batch_id}/void` | JWT; Owner, Admin Operasional                  | `200`  | `Authorization`, `Idempotency-Key`, `Content-Type` |
| `GET /api/v1/audit-logs`                    | JWT; Owner, Admin Operasional, Kepala Budidaya | `200`  | `Authorization`                                    |

Pada daftar endpoint di atas, `{id}` dan `{batch_id}` adalah placeholder dokumentasi untuk parameter route Nest `:id` dan `:batch_id`. GET endpoint tidak memerlukan `Content-Type`; `Accept: application/json` bersifat opsional.

### Query Parameter per Endpoint

| Endpoint                                    | Query yang didefinisikan                            |
| ------------------------------------------- | --------------------------------------------------- |
| `POST /api/v1/auth/login`                   | Tidak ada                                           |
| `GET /api/v1/fish-species`                  | Tidak ada filter atau pagination yang didefinisikan |
| `POST /api/v1/fish-entries`                 | Tidak ada                                           |
| `GET /api/v1/batches`                       | `page`, `limit`, `startDate`, `endDate`, `status`   |
| `GET /api/v1/batches/{id}`                  | Tidak ada                                           |
| `POST /api/v1/fish-entries/{batch_id}/void` | Tidak ada                                           |
| `GET /api/v1/audit-logs`                    | `page`, `limit`, `startDate`, `endDate`             |

Perilaku daftar mengikuti `TBD-09` yang telah `APPROVED — OWNER` melalui ADR 0001: `page=1`, `limit=20` (maksimum `100`), rentang timestamp ISO 8601 dengan offset/UTC eksplisit, batas tanggal inklusif, hasil terbaru dahulu (`created_at DESC, id DESC`). `status` hanya berlaku untuk batch dengan nilai resmi `active`, `completed`, atau `voided`; audit log tidak memiliki filter status. Pencarian dan pilihan sort tambahan tidak didefinisikan. Timestamp utama yang difilter adalah `batches.created_at` atau `audit_logs.created_at` sesuai endpoint.

## Skema Request dan Response

### `POST /api/v1/auth/login`

Request body strict; field lain ditolak. Email harus lolos validasi format sebelum ditransformasikan menjadi lowercase (transform juga memanggil `trim`, tetapi validasi format terjadi terlebih dahulu). Password 1–72 karakter.

```json
{
  "email": "owner@example.test",
  "password": "<password>"
}
```

`200 OK`:

```json
{
  "status": "success",
  "message": "Login berhasil.",
  "data": {
    "access_token": "<jwt>",
    "token_type": "Bearer",
    "expires_in": "<configured-duration>",
    "user": {
      "id": "<uuid>",
      "name": "Nama Pengguna",
      "email": "owner@example.test",
      "role": "Owner"
    }
  }
}
```

Password hash tidak pernah dikembalikan. Email/password salah dan akun nonaktif sama-sama menghasilkan `401 UNAUTHORIZED` dengan pesan generik. Endpoint menerapkan batas 5 request per 60 detik sesuai konfigurasi controller.

### `GET /api/v1/fish-species`

Tidak ada query parameter/filter yang didefinisikan. Mengembalikan spesies aktif, urut `species_name` lalu `id` menaik.

```json
{
  "status": "success",
  "message": "Daftar spesies aktif berhasil dimuat.",
  "data": [
    {
      "id": "<uuid>",
      "species_code": "LELE",
      "species_name": "Lele"
    }
  ]
}
```

### `GET /api/v1/batches`

Query parameter:

| Nama        | Tipe / aturan                                                  | Default        |
| ----------- | -------------------------------------------------------------- | -------------- |
| `page`      | Integer >= 1                                                   | `1`            |
| `limit`     | Integer 1–100                                                  | `20`           |
| `status`    | Salah satu `active`, `completed`, `voided`                     | Tidak difilter |
| `startDate` | ISO 8601 datetime dengan timezone/offset                       | Tidak difilter |
| `endDate`   | ISO 8601 datetime dengan timezone/offset; harus >= `startDate` | Tidak difilter |

Parameter tambahan ditolak. Batas tanggal diterapkan ke timestamp `created_at`; urutan terbaru dahulu, lalu `id` menurun sebagai pemecah seri.

`200 OK`:

```json
{
  "status": "success",
  "message": "Daftar batch berhasil dimuat.",
  "data": {
    "items": [
      {
        "batch": {
          "id": "<uuid>",
          "batch_code": "PFI-BCH-20261117-001",
          "status": "active",
          "current_stock": 500,
          "created_at": "2026-11-17T03:00:00.000Z"
        },
        "species": {
          "id": "<uuid>",
          "species_code": "LELE",
          "species_name": "Lele"
        },
        "incoming_fish": {
          "id": "<uuid>",
          "entry_date": "2026-11-17",
          "quantity": 500,
          "purchase_capital": "2500000.00",
          "shipping_capital": "150000.00",
          "weight_sample_per_500": "485.50",
          "fish_size": "3-5 cm",
          "created_at": "2026-11-17T03:00:00.000Z",
          "voided": false
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

Implementasi memetakan `incoming_fish` sebagai nullable pada response persistence. Untuk data valid yang berhasil commit, constraint V4.5 mengharuskan relasi batch-penerimaan 1:1 sehingga nilai normalnya objek, bukan `null`.

### `GET /api/v1/batches/{id}`

`id` wajib UUID. Response `200 OK` memakai bentuk satu item dari endpoint list tanpa wrapper `items`/`pagination`:

```json
{
  "status": "success",
  "message": "Detail batch berhasil dimuat.",
  "data": {
    "batch": {
      "id": "<uuid>",
      "batch_code": "PFI-BCH-20261117-001",
      "status": "active",
      "current_stock": 500,
      "created_at": "2026-11-17T03:00:00.000Z"
    },
    "species": {
      "id": "<uuid>",
      "species_code": "LELE",
      "species_name": "Lele"
    },
    "incoming_fish": {
      "id": "<uuid>",
      "entry_date": "2026-11-17",
      "quantity": 500,
      "purchase_capital": "2500000.00",
      "shipping_capital": "150000.00",
      "weight_sample_per_500": null,
      "fish_size": "3-5 cm",
      "created_at": "2026-11-17T03:00:00.000Z",
      "voided": false
    }
  }
}
```

Jika batch tidak ditemukan, endpoint mengembalikan `404 BATCH_NOT_FOUND`. `incoming_fish.quantity` tetap merupakan jumlah penerimaan historis; `batch.current_stock` adalah hasil kalkulasi stok. Pada V4.5 saat ini, sumber gerak yang tersedia adalah penerimaan dan Receiving VOID. Penjualan dan mortalitas belum menjadi sumber stok sampai modul terkait disetujui dan tersedia.

### `POST /api/v1/fish-entries`

Wajib JWT, UUIDv4 `Idempotency-Key`, dan JSON body. Request body strict:

| Field                   | Tipe / aturan                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `species_id`            | UUID spesies aktif                                                                           |
| `entry_date`            | ISO date `YYYY-MM-DD`; tidak boleh melewati tanggal `Asia/Jakarta` saat ini                  |
| `quantity`              | Integer 1–1,000,000                                                                          |
| `purchase_capital`      | String desimal 0.00–9,999,999,999.00 IDR; wajib, tanpa default                               |
| `shipping_capital`      | String desimal 0.00–9,999,999,999.00 IDR; wajib, tanpa default                               |
| `weight_sample_per_500` | Opsional/null atau string desimal 0.01–100,000.00 gram                                       |
| `fish_size`             | `2-4 cm`, `3-5 cm`, `4-6 cm`, `5-7 cm`, `6-8 cm`, `7-9 cm`, `8-10 cm`, `9-11 cm`, `10-12 cm` |

Contoh body:

```json
{
  "species_id": "<uuid>",
  "entry_date": "2026-11-17",
  "quantity": 500,
  "purchase_capital": "2500000.00",
  "shipping_capital": "150000.00",
  "weight_sample_per_500": "485.50",
  "fish_size": "3-5 cm"
}
```

`201 Created`:

```json
{
  "status": "success",
  "message": "Penerimaan ikan berhasil dicatat dan Batch telah dibuat.",
  "data": {
    "batch": {
      "id": "<uuid>",
      "batch_code": "PFI-BCH-20261117-001",
      "status": "active"
    },
    "incoming_fish": {
      "id": "<uuid>",
      "entry_date": "2026-11-17",
      "quantity": 500,
      "purchase_capital": "2500000.00",
      "shipping_capital": "150000.00",
      "weight_sample_per_500": "485.50",
      "fish_size": "3-5 cm"
    }
  },
  "meta": {
    "idempotency_status": "executed",
    "request_id": "<uuid>"
  }
}
```

Retry identik tetap `201`; `status`, `message`, dan `data` berasal dari hasil tersimpan, sementara `meta.idempotency_status` menjadi `cached` dan `request_id` baru. Validasi schema sebelum service tidak memakai key. Kegagalan domain di dalam transaksi melakukan rollback.

### `POST /api/v1/fish-entries/{batch_id}/void`

`batch_id` wajib UUID; request body strict dan `reason` wajib string setelah trim dengan panjang minimal 1.

```json
{
  "reason": "Koreksi pencatatan penerimaan."
}
```

`200 OK`:

```json
{
  "status": "success",
  "message": "Transaksi penerimaan ikan berhasil di-VOID.",
  "data": {
    "batch_id": "<uuid>",
    "batch_code": "PFI-BCH-20261117-001",
    "status": "voided"
  },
  "meta": {
    "idempotency_status": "executed",
    "request_id": "<uuid>"
  }
}
```

Retry dengan key dan reason yang sama mengembalikan data cached serta request ID baru. Retry dengan key yang sama tetapi reason berbeda mendapat `409 IDEMPOTENCY_MISMATCH`. Key berbeda untuk batch yang sudah tidak `active` mendapat `409 BATCH_NOT_ACTIVE`.

### `GET /api/v1/audit-logs`

Query menerima `page`, `limit`, `startDate`, dan `endDate` dengan aturan yang sama seperti list batch; filter tanggal memakai `created_at`. Owner dan Admin Operasional melihat seluruh audit V4.5. Kepala Budidaya hanya melihat `CREATE_ENTRY` dan `VOID_ENTRY`.

`200 OK`:

```json
{
  "status": "success",
  "message": "Daftar audit log berhasil dimuat.",
  "data": {
    "items": [
      {
        "id": "<uuid>",
        "request_id": "<uuid>",
        "actor": { "id": "<uuid>", "name": "Nama Pengguna" },
        "action": "CREATE_ENTRY",
        "entity_type": "incoming_fish",
        "entity_id": "<uuid>",
        "old_values": null,
        "new_values": null,
        "reason": null,
        "ip_address": "192.0.2.10",
        "created_at": "2026-11-17T03:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

## Error Code dan HTTP Status

Semua error diproses oleh `ApiExceptionFilter` dan memakai envelope error pada bagian sebelumnya. Respons tidak mengandung stack trace, SQL, metadata database mentah, token, password, atau detail internal. Untuk exception yang dikenal API mengirim pesan aman dan kode stabil; exception tak terduga disamarkan sebagai `500 INTERNAL_SERVER_ERROR`. Login yang gagal tidak membedakan email tidak dikenal, password salah, atau akun nonaktif.

`INVALID_PAYLOAD` digunakan oleh schema Zod untuk body, UUID path, dan query yang divalidasi. `INVALID_REQUEST` adalah fallback untuk HTTP 4xx framework yang tidak memiliki kode khusus; route yang tidak ditemukan memakai `404 NOT_FOUND`. Detail batch dan VOID memakai `404 BATCH_NOT_FOUND`.

| HTTP  | Error code                   | Endpoint / kondisi                                                                                                                       |
| ----- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `400` | `INVALID_PAYLOAD`            | JSON/body tidak valid, field hilang/tambahan, batas field salah, UUID path invalid, atau query tidak valid.                              |
| `400` | `INVALID_IDEMPOTENCY_KEY`    | Endpoint mutasi menerima key hilang atau bukan UUIDv4.                                                                                   |
| `400` | `INVALID_REQUEST`            | Fallback untuk HTTP 4xx framework yang tidak mempunyai kode endpoint khusus.                                                             |
| `401` | `UNAUTHORIZED`               | Token hilang/tidak valid/kedaluwarsa, akun nonaktif, role tidak dikenal di V4.5; juga kredensial login salah. Pesan login tetap generik. |
| `403` | `FORBIDDEN`                  | Token valid untuk user V4.5 tetapi role tidak diizinkan pada endpoint.                                                                   |
| `404` | `BATCH_NOT_FOUND`            | Batch tidak ditemukan pada `GET /api/v1/batches/{id}` atau batch/receipt tidak ditemukan saat VOID.                                      |
| `404` | `NOT_FOUND`                  | Route atau resource umum yang tidak memiliki kode 404 khusus.                                                                            |
| `409` | `IDEMPOTENCY_MISMATCH`       | Key sama untuk user+endpoint sudah dipakai dengan payload bisnis berbeda.                                                                |
| `409` | `IDEMPOTENCY_IN_PROGRESS`    | Key ditemukan dengan pemrosesan yang belum selesai; kode ini berasal dari implementasi.                                                  |
| `409` | `BATCH_NOT_ACTIVE`           | Batch VOID tidak lagi berstatus `active`, termasuk retry dengan key berbeda.                                                             |
| `409` | `HAS_DEPENDENT_TRANSACTIONS` | Batch memiliki transaksi turunan; kode dikunci blueprint tetapi jalur ini belum dapat diverifikasi karena dependensi belum ada.          |
| `422` | `SPECIES_NOT_ACTIVE`         | Spesies tidak ditemukan atau tidak aktif saat penerimaan.                                                                                |
| `422` | `INVALID_ENTRY_DATE`         | `entry_date` melewati tanggal `Asia/Jakarta` saat ini.                                                                                   |
| `422` | `BATCH_SEQUENCE_EXHAUSTED`   | Sequence batch tanggal tersebut telah mencapai 999.                                                                                      |
| `429` | `RATE_LIMIT_EXCEEDED`        | Login melewati batas 5 request per 60 detik.                                                                                             |
| `500` | `INTERNAL_SERVER_ERROR`      | Kegagalan tak terduga; detail internal tidak dikirim.                                                                                    |
| `503` | `DATABASE_LOCK_TIMEOUT`      | Lock timeout, lock unavailable, atau statement timeout yang dikenali backend.                                                            |
| `503` | `DATABASE_UNAVAILABLE`       | Database tidak tersedia atau koneksi terputus untuk kode koneksi yang dikenali backend.                                                  |

## Pemetaan Role dan Status

| Endpoint                   | Owner               | Admin Operasional   | Kepala Budidaya                              |
| -------------------------- | ------------------- | ------------------- | -------------------------------------------- |
| Login                      | Ya, jika akun aktif | Ya, jika akun aktif | Ya, jika akun aktif                          |
| Baca spesies, batch, audit | Diizinkan           | Diizinkan           | Diizinkan; audit dibatasi ke Receiving/Batch |
| Buat penerimaan            | Diizinkan           | Diizinkan           | Diizinkan                                    |
| VOID penerimaan            | Diizinkan           | Diizinkan           | `403 FORBIDDEN`                              |

## QA Pointers

| Endpoint / concern                                                                        | Test source                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Login, token, rate limit, generic auth errors                                             | [auth.e2e.spec.ts](../apps/api/test/auth.e2e.spec.ts)                 |
| Species, batch list/detail, audit filtering, create envelope and query validation         | [core-api.e2e.spec.ts](../apps/api/test/core-api.e2e.spec.ts)         |
| Receiving/VOID contract errors, idempotency, concurrency and DB-backed cases TC-01..TC-32 | [v45-contract.e2e.spec.ts](../apps/api/test/v45-contract.e2e.spec.ts) |
| Error sanitization and auth security                                                      | [security.e2e.spec.ts](../apps/api/test/security.e2e.spec.ts)         |

Test source presence is not proof of a passing run. TC-20 and TC-28 are currently skipped; the database-backed contract suite requires an isolated test database and `RUN_V45_DB_TESTS=1`.
