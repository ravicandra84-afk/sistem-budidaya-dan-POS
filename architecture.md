# DOKUMEN ARSITEKTUR SISTEM (SYSTEM ARCHITECTURE)

# Sistem Manajemen Operasional Pisciculture Farm Indonesia (PFI)

| Informasi         | Nilai                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Dokumen           | `architecture.md`                                                                                         |
| Versi             | 1.1                                                                                                       |
| Status            | Baseline V4.5 Locked dengan addendum arsitektur V4.6 pasca-MVP yang disetujui Owner                       |
| Produk            | Sistem Manajemen Operasional Pisciculture Farm Indonesia (PFI)                                            |
| Cakupan           | Keseluruhan MVP: Penerimaan Ikan, Manajemen Batch, dan Ikan Keluar (Kasir/POS)                            |
| Zona Waktu Bisnis | `Asia/Jakarta` ($\text{UTC}+7$)                                                                           |
| Basis Data Utama  | PostgreSQL 13+                                                                                            |
| Dokumen Acuan     | `master_blueprint_api_contract_pfi_main.md`, `prd.md`, `implementation_plan.md`, `AGENTS.md`, `GEMINI.md` |

---

## 1. Tujuan dan Kedudukan Dokumen

Dokumen ini menjelaskan gambaran besar struktur sistem, arsitektur perangkat lunak, skema database dan relasi antar tabel, alur data transaksi, kontrol konkurensi dan keamanan, serta strategi integrasi perangkat untuk Sistem Manajemen Operasional **Pisciculture Farm Indonesia (PFI)**.

### 1.1 Hierarki Sumber Kebenaran

Apabila ditemukan perbedaan antar dokumen atau kode selama pengembangan, urutan otoritas yang berlaku adalah:

1. Keputusan bisnis dan teknis eksplisit terbaru dari pemilik produk.
2. Master Blueprint V4.5 untuk modul Penerimaan Ikan, Batch, dan VOID Penerimaan.
3. Keputusan bisnis yang dikonfirmasi pada perluasan modul Ikan Keluar (Kasir/POS).
4. `prd.md` untuk kebutuhan fungsional, halaman, alur pengguna, dan _acceptance criteria_.
5. `architecture.md` (dokumen ini) untuk struktur arsitektur, skema data, dan batas integrasi sistem.
6. `implementation_plan.md` untuk urutan fase pengerjaan dan gerbang persetujuan (_gates_).

### 1.2 Legenda Status Keputusan Arsitektur

Setiap komponen dalam dokumen ini membawa penanda status agar tim pengembang dan agen AI tidak mencampuradukkan kontrak yang sudah dikunci dengan rancangan yang masih menunggu finalisasi:

| Status                 | Makna                                                                                     | Aturan Implementasi                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `LOCKED — V4.5`        | Aturan arsitektur, skema, dan API Penerimaan/Batch/VOID V4.5 yang telah dikunci.          | Wajib diimplementasikan persis sesuai spesifikasi.                                       |
| `LOCKED — BUSINESS`    | Aturan bisnis POS yang telah disetujui.                                                   | Perilaku bisnis tidak boleh diubah atau diasumsikan ulang.                               |
| `APPROVED — OWNER`     | Keputusan arsitektur/skema yang ditetapkan pemilik produk pada sesi desain arsitektur.    | Berlaku sebagai acuan desain sistem dan siap diturunkan ke kontrak teknis.               |
| `PROPOSED — TECHNICAL` | Rekomendasi stack atau rancangan teknis yang masih bersifat kandidat.                     | Menunggu audit repository (`P0-01`) atau penguncian kontrak detail sebelum coding final. |
| `TBD — NEEDS DECISION` | Detail teknis yang sengaja dibiarkan terbuka hingga tahap pengujian/finalisasi kontrak.   | Dilarang diisi dengan asumsi sepihak; wajib difinalisasi pada gerbang terkait.           |
| `OUT OF SCOPE`         | Fitur di luar cakupan MVP (akuntansi, CRM, modul kematian, pakan, payment gateway, dll.). | Tidak boleh dibangun pada fase ini.                                                      |

---

## 2. Gambaran Besar Struktur Sistem

### 2.1 Gaya Arsitektur dan Topologi Sistem

Sistem PFI menggunakan arsitektur **Decoupled Client-Server berbasis REST API** untuk mendukung akses multi-klien (Android, iPhone, PC, dan laptop) terhadap satu sumber kebenaran data terpusat.

```mermaid
flowchart TB
    subgraph Clients["Lapisan Klien Multi-Platform (Browser / Web App)"]
        C1["PC / Laptop\n(Owner, Admin Operasional,\nKepala Budidaya, Kasir)"]
        C2["Smartphone Android / iPhone\n(Kasir POS & Operasional Lapangan)"]
    end

    subgraph Peripherals["Perangkat Lokal Kasir (Client-Side Printing)"]
        P1["Printer Thermal 58mm / 80mm\n(Bluetooth ESC/POS - Mobile)"]
        P2["Printer Thermal 58mm / 80mm\n(Web USB / Browser Print - PC/Laptop)"]
    end

    subgraph Cloud["Infrastruktur Cloud (Zona Waktu: Asia/Jakarta)"]
        FE["Frontend Web Application\n(React.js / Next.js atau Vue.js)"]
        BE["Backend REST API Service\n(Node.js + TypeScript + Express.js / NestJS)"]
        DB[("PostgreSQL 13+\n(Primary ACID Data Store,\nTriggers, Sequences, Audit Logs)")]
    end

    C1 <-->|"HTTPS"| FE
    C2 <-->|"HTTPS"| FE
    C1 <-->|"HTTPS REST API\n(JSON + JWT + Idempotency-Key)"| BE
    C2 <-->|"HTTPS REST API\n(JSON + JWT + Idempotency-Key)"| BE
    BE <-->|"SQL / ACID Transactions\n(Prisma ORM / TypeORM)"| DB
    C2 -.->|"ESC/POS via Bluetooth\n(Pasca-Commit)"| P1
    C1 -.->|"Web USB / Browser Print\n(Pasca-Commit)"| P2
```

### 2.2 Ketetapan dan Rekomendasi Technology Stack

Bagian ini memisahkan teknologi yang sudah dikunci secara mutlak dari stack rekomendasi yang ditetapkan untuk efisiensi pengembangan (`Task P0-02`):

| Lapisan                         | Teknologi / Spesifikasi                                       | Status                                  | Keterangan & Pertimbangan Arsitektur                                                                                                       |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Database Engine**             | PostgreSQL 13+                                                | `LOCKED — V4.5`                         | Sumber kebenaran tunggal dengan dukungan ACID, `SELECT ... FOR UPDATE`, _Deferred Constraint Trigger_, `JSONB`, dan _granular privileges_. |
| **Zona Waktu Bisnis**           | `Asia/Jakarta` ($\text{UTC}+7$)                               | `LOCKED — V4.5`                         | Seluruh validasi tanggal penerimaan (`entry_date`) dan penomoran harian batch/penjualan mengacu pada tanggal $\text{UTC}+7$.               |
| **Gaya Arsitektur**             | Decoupled Frontend & Backend via REST API                     | `APPROVED — OWNER`                      | Memisahkan UI multi-perangkat dari logika bisnis dan otorisasi server.                                                                     |
| **Backend Runtime & Framework** | Node.js + TypeScript + NestJS                                 | `APPROVED — OWNER` (ADR 0001)           | REST API modular; identitas dan RBAC tetap ditegakkan di backend.                                                                          |
| **Frontend Framework**          | Next.js App Router + React                                    | `APPROVED — OWNER` (ADR 0001)           | Client terpisah dari API; UI operasional mengikuti PRD dan skill UI/UX.                                                                    |
| **Data Access / ORM**           | Prisma ORM + parameterized raw SQL                            | `APPROVED — OWNER` (ADR 0001)           | Gunakan transaksi interaktif/raw SQL berparameter untuk `SELECT ... FOR UPDATE`, sequence atomik, dan PostgreSQL triggers.                 |
| **Validation**                  | Zod + class-validator                                         | `APPROVED — OWNER` (ADR 0001)           | Skema lintas aplikasi berada di shared package; backend tetap memvalidasi boundary request.                                                |
| **CSS & Components**            | Tailwind CSS + shadcn/ui                                      | `APPROVED — OWNER` (ADR 0001)           | Komponen UI mengikuti sistem desain PFI dan tidak mengubah aturan domain.                                                                  |
| **Test Framework**              | Jest + Supertest                                              | `APPROVED — OWNER` (ADR 0001)           | Unit dan API integration tests; test database memakai PostgreSQL terpisah.                                                                 |
| **Workspace**                   | npm workspaces (`apps/api`, `apps/web`, `packages/shared`)    | `APPROVED — OWNER` (ADR 0001)           | Tipe, RBAC enums, response envelope, dan skema Zod bersama di `packages/shared`.                                                           |
| **Migration Tool**              | Prisma Migrate atau Golang Migrate                            | `APPROVED — OWNER` _(Opsi Rekomendasi)_ | Harus mendukung eksekusi skrip DDL custom (constraint trigger, fungsi PL/pgSQL, dan `GRANT`/`REVOKE` granular).                            |
| **Infrastruktur & Hosting**     | Cloud (Supabase, Render, Vercel, atau AWS)                    | `APPROVED — OWNER` _(Opsi Rekomendasi)_ | Lingkungan server dan database wajib dikonfigurasi dengan timezone `Asia/Jakarta` dan penyimpanan timestamp bertipe `TIMESTAMPTZ`.         |
| **Protokol Komunikasi**         | HTTPS + REST JSON + JWT + `Idempotency-Key` ($\text{UUIDv4}$) | `LOCKED` / `APPROVED — OWNER`           | Seluruh mutasi data (`POST`/`PATCH`/`PUT`) menggunakan header `Idempotency-Key` dan token JWT terverifikasi.                               |

### 2.3 Pemisahan Tanggung Jawab Lapisan (Layered Architecture)

Di dalam layanan Backend REST API, struktur kode dipisahkan menjadi empat lapisan tegas:

1. **Transport / HTTP Layer (Controller & Middleware):**
   - Memverifikasi token JWT, memeriksa status aktif akun (`is_active`), menegakkan RBAC per endpoint, memvalidasi format header `Idempotency-Key` ($\text{UUIDv4}$), dan memetakan respons JSON serta kode status HTTP.
2. **Validation & Normalization Layer:**
   - Memvalidasi skema payload, batas numerik, enum ukuran ikan, aturan tanggal `Asia/Jakarta`, serta melakukan normalisasi JSON dan perhitungan hash `SHA-256` untuk kebutuhan idempotency.
3. **Domain & Transaction Service Layer:**
   - Mengorkestrasi transaksi database ACID, penguncian baris batch (`SELECT ... FOR UPDATE`), alokasi sequence harian atomik, kalkulasi stok terkomputasi, pembuatan snapshot harga, dan penulisan `audit_logs` dalam satu unit kerja atomik.
4. **Persistence Layer (Database & PostgreSQL Guardrails):**
   - Menegakkan integritas tingkat lanjut melalui `CHECK` constraints, `UNIQUE` indexes, `FOREIGN KEY ... ON DELETE RESTRICT`, _Deferred Constraint Trigger_ ($1:1$ batch-penerimaan), _Immutability Triggers_, dan pemisahan _Migration Role_ vs _App Runtime Role_.

---

## 3. Arsitektur Keamanan, Autentikasi, dan Otorisasi

### 3.1 Autentikasi dan Identitas Aktor

- **Mekanisme Autentikasi (`FR-AUTH-01`):** Backend memverifikasi tanda tangan dan masa berlaku token JWT pada setiap endpoint terlindungi.
- **Otoritas Identitas (`NFR-SEC-01`):** Seluruh kolom pelaku (`created_by`, `voided_by`, `updated_by`, `actor_id`) diekstrak secara eksklusif dari _claims_ JWT yang telah diverifikasi. Payload dari frontend tidak pernah dipercaya sebagai penentu identitas pengguna.
- **Status Akun (`FR-AUTH-02`):** Pengguna dengan `is_active = false` ditolak aksesnya pada setiap permintaan terautentikasi.
- **Kardinalitas Role (`FR-AUTH-03`):** Setiap pengguna memiliki tepat satu role pada cakupan MVP.

### 3.2 Matriks Otorisasi RBAC Gabungan (4 Role)

Sistem mengenali empat role utama: `Owner`, `Admin Operasional`, `Kepala Budidaya`, dan `Kasir`.

| Fitur / Operasi Sistem                          |      `Owner`      |   `Admin Operasional`   |              `Kepala Budidaya`              |          `Kasir`          | Status Aturan                                     |
| ----------------------------------------------- | :---------------: | :---------------------: | :-----------------------------------------: | :-----------------------: | ------------------------------------------------- |
| **Melihat Data Penerimaan & Batch**             |     Diizinkan     |        Diizinkan        |                  Diizinkan                  |          Ditolak          | `LOCKED — V4.5`                                   |
| **Membuat Penerimaan Ikan (`POST`)**            |     Diizinkan     |        Diizinkan        |                  Diizinkan                  |          Ditolak          | `LOCKED — V4.5`, Owner-approved update 2026-11-17 |
| **Melakukan VOID Penerimaan (`POST`)**          |     Diizinkan     |        Diizinkan        |                   Ditolak                   |          Ditolak          | `LOCKED — V4.5`, Owner-approved update 2026-11-17 |
| **Mengelola Master Spesies (API/UI)**           |      Ditolak      | Ditolak _(Via DB Seed)_ |                   Ditolak                   |          Ditolak          | `LOCKED — V4.5`                                   |
| **Melihat Laporan Audit Log**                   | Diizinkan (Semua) |    Diizinkan (Semua)    | Diizinkan _(Khusus Modul Penerimaan/Batch)_ | **Ditolak (`Forbidden`)** | `LOCKED — V4.5` + `APPROVED — OWNER` (`TBD-07`)   |
| **Mengakses Halaman Kasir / POS**               |     Diizinkan     |        Diizinkan        |                   Ditolak                   |         Diizinkan         | `LOCKED — BUSINESS`                               |
| **Melihat Seluruh Transaksi Penjualan**         |     Diizinkan     |        Diizinkan        |                   Ditolak                   |         Diizinkan         | `LOCKED — BUSINESS`                               |
| **Membuat Transaksi Penjualan**                 |     Diizinkan     |        Diizinkan        |                   Ditolak                   |         Diizinkan         | `LOCKED — BUSINESS`                               |
| **Melakukan VOID Penjualan (Utuh)**             |     Diizinkan     |        Diizinkan        |                   Ditolak                   |         Diizinkan         | `LOCKED — BUSINESS`                               |
| **Menambah / Mengubah Daftar Harga**            |     Diizinkan     |        Diizinkan        |                   Ditolak                   |          Ditolak          | `LOCKED — BUSINESS`                               |
| **Menghapus Daftar Harga**                      |      Ditolak      |         Ditolak         |                   Ditolak                   |          Ditolak          | `LOCKED — BUSINESS`                               |
| **Cetak Ulang Struk (Milik Sendiri, Non-VOID)** |     Diizinkan     |        Diizinkan        |                   Ditolak                   |         Diizinkan         | `LOCKED — BUSINESS`                               |
| **Cetak Ulang Struk (Milik Pengguna Lain)**     |      Ditolak      |         Ditolak         |                   Ditolak                   |          Ditolak          | `LOCKED — BUSINESS`                               |

### 3.2.1 Tambahan RBAC V4.6 (`APPROVED — OWNER`)

- `Kepala Budidaya` dan `Owner` boleh mengubah `batches.sale_readiness` ke atau dari `BELUM_SIAP`/`SIAP_JUAL`. Hak ini tidak mengizinkan perubahan `batches.status`.
- Owner dan `Admin Operasional` boleh mengelola kategori/produk POS, termasuk menambah, mengubah, dan mengarsipkan melalui `is_active = false`. Istilah Admin pada keputusan V4.6 dipetakan ke role aktif `Admin Operasional`; tidak ada role baru.
- Seluruh otorisasi wajib ditegakkan backend berdasarkan JWT terverifikasi. Runtime database hanya memperoleh privilege kolom minimum yang dibutuhkan.

### 3.3 Keamanan Lapisan Database (Least Privilege & Immutability)

Arsitektur database memisahkan dua peran koneksi PostgreSQL:

1. **Migration Role (DDL):** Digunakan hanya saat deployment migrasi skema dan _seeding_ awal (`CREATE`, `ALTER`, `DROP`, `TRIGGER`, `GRANT`).
2. **App Runtime Role (DML Granular):** Digunakan oleh layanan backend saat runtime dengan hak akses terbatas:
   - **Tabel Append-Only:** `incoming_fish`, `incoming_fish_voids`, `audit_logs`, `fish_sales`, `fish_sale_voids`, dan `batch_sale_readiness_histories` hanya memiliki hak `SELECT` dan `INSERT`; hak `UPDATE` dan `DELETE` dicabut.
   - **Proteksi Trigger:** Trigger `BEFORE UPDATE OR DELETE` dipasang pada seluruh tabel append-only untuk melemparkan `EXCEPTION` apabila ada upaya modifikasi atau penghapusan baris historis dari jalur koneksi mana pun.
   - **Tabel Sequence, Katalog & Status Terkendali:** `batch_daily_sequences` memiliki `SELECT`, `INSERT`, dan `UPDATE` terbatas pada `last_number`; pada V4.6, `batches` menambah grant UPDATE kolom `sale_readiness` terpisah dari `status`. `product_categories` dan `products` menerima grants granular sesuai aksi katalog. `idempotency_keys` hanya dapat di-`UPDATE` pada `status`, `response_status`, `response_body`, dan `completed_at`. Grants final ditetapkan pada P8-01.

---

## 4. Arsitektur Database dan Skema Relasional

### 4.1 Entity Relationship Diagram (ERD)

Diagram berikut memetakan 8 tabel terkunci dari V4.5 bersama 4 tabel perluasan POS:

```mermaid
erDiagram
    users ||--o{ batches : "creates (created_by)"
    users ||--o{ incoming_fish : "records (created_by)"
    users ||--o{ incoming_fish_voids : "voids (voided_by)"
    users ||--o{ idempotency_keys : "owns (user_id)"
    users ||--o{ audit_logs : "performs (actor_id)"
    users ||--o{ fish_sale_prices : "manages (created_by / updated_by)"
    users ||--o{ fish_sales : "sells (created_by)"
    users ||--o{ fish_sale_voids : "voids (voided_by)"

    fish_species ||--o{ batches : "categorizes (species_id)"
    fish_species ||--o{ fish_sale_prices : "priced_for (species_id)"

    batches ||--|| incoming_fish : "1:1 strict (batch_id)"
    batches ||--o{ fish_sales : "sold_from (batch_id)"

    incoming_fish ||--o| incoming_fish_voids : "reversed_by (incoming_fish_id)"
    fish_sales ||--o| fish_sale_voids : "reversed_by (sale_id)"

    users {
        UUID id PK
        VARCHAR name
        CITEXT email UK
        VARCHAR password_hash
        VARCHAR role
        BOOLEAN is_active
        TIMESTAMPTZ created_at
    }

    fish_species {
        UUID id PK
        VARCHAR species_code UK
        VARCHAR species_name
        BOOLEAN is_active
        TIMESTAMPTZ created_at
    }

    batch_daily_sequences {
        DATE entry_date PK
        INTEGER last_number
    }

    batches {
        UUID id PK
        VARCHAR batch_code UK
        UUID species_id FK
        VARCHAR status
        UUID created_by FK
        TIMESTAMPTZ created_at
    }

    incoming_fish {
        UUID id PK
        UUID batch_id FK
        DATE entry_date
        INTEGER quantity
        NUMERIC purchase_capital
        NUMERIC shipping_capital
        NUMERIC weight_sample_per_500
        VARCHAR fish_size
        UUID created_by FK
        TIMESTAMPTZ created_at
    }

    incoming_fish_voids {
        UUID id PK
        UUID incoming_fish_id FK
        TEXT reason
        UUID voided_by FK
        TIMESTAMPTZ voided_at
    }

    sale_daily_sequences {
        DATE sale_date PK
        BIGINT last_number
    }

    fish_sale_prices {
        UUID id PK
        UUID species_id FK
        VARCHAR fish_size
        BIGINT price_per_fish
        UUID created_by FK
        TIMESTAMPTZ created_at
        UUID updated_by FK
        TIMESTAMPTZ updated_at
    }

    fish_sales {
        UUID id PK
        VARCHAR sale_code UK
        UUID batch_id FK
        INTEGER quantity
        BIGINT unit_price
        BIGINT total_amount
        VARCHAR payment_method
        BIGINT cash_received
        BIGINT change_amount
        UUID created_by FK
        TIMESTAMPTZ created_at
    }

    fish_sale_voids {
        UUID id PK
        UUID sale_id FK
        UUID voided_by FK
        TIMESTAMPTZ voided_at
    }

    idempotency_keys {
        UUID id PK
        UUID user_id FK
        VARCHAR endpoint
        UUID idempotency_key
        VARCHAR payload_hash
        VARCHAR status
        INTEGER response_status
        JSONB response_body
        TIMESTAMPTZ created_at
        TIMESTAMPTZ completed_at
    }

    audit_logs {
        UUID id PK
        VARCHAR request_id
        UUID actor_id FK
        VARCHAR action
        VARCHAR entity_type
        UUID entity_id
        JSONB old_values
        JSONB new_values
        TEXT reason
        VARCHAR ip_address
        TIMESTAMPTZ created_at
    }
```

### 4.2 Skema Tabel Modul V4.5 (`LOCKED — V4.5` dengan Perluasan Role & Action)

#### 1. `users`

Menyimpan identitas pengguna dan role tunggal per akun.

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `name`: `VARCHAR(255) NOT NULL`
- `email`: `CITEXT` / `VARCHAR(255) NOT NULL` dengan unique index `LOWER(email)`
- `password_hash`: `VARCHAR(255) NOT NULL`
- `role`: `VARCHAR(50) NOT NULL` — pada migrasi Fase 7 (`P7-01`), constraint `CHECK` V4.5 diperbarui melalui `ALTER TABLE users` agar menerima `'Owner'`, `'Admin Operasional'`, `'Kepala Budidaya'`, dan `'Kasir'` (`LOCKED — BUSINESS`).
- `is_active`: `BOOLEAN NOT NULL DEFAULT true`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### 2. `fish_species`

Master spesies ikan (diisi melalui migration seed: `LELE`, `PATIN`, `GURAME-MERAH`, `GURAME-HITAM`, `NILA-HITAM`, `NILA-MERAH`).

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `species_code`: `VARCHAR(50) NOT NULL UNIQUE`
- `species_name`: `VARCHAR(100) NOT NULL`
- `is_active`: `BOOLEAN NOT NULL DEFAULT true`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### 3. `batch_daily_sequences`

Sequence harian atomik untuk kode batch berbasis `entry_date`.

- `entry_date`: `DATE PRIMARY KEY`
- `last_number`: `INTEGER NOT NULL CHECK (last_number BETWEEN 0 AND 999)`

#### 4. `batches`

Entitas induk kelompok ikan homogen (1 spesies, 1 ukuran).

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `batch_code`: `VARCHAR(50) NOT NULL UNIQUE` (Format: `PFI-BCH-YYYYMMDD-XXX`)
- `species_id`: `UUID NOT NULL REFERENCES fish_species(id) ON DELETE RESTRICT`
- `status`: `VARCHAR(20) NOT NULL CHECK (status IN ('active', 'completed', 'voided'))`
- `created_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Constraint Khusus:** _Deferred Constraint Trigger_ (`INITIALLY DEFERRED`) memastikan setiap baris `batches` memiliki tepat satu baris `incoming_fish` saat transaksi `COMMIT`.

#### 5. `incoming_fish` _(Append-Only / Immutable)_

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `batch_id`: `UUID NOT NULL UNIQUE REFERENCES batches(id) ON DELETE RESTRICT`
- `entry_date`: `DATE NOT NULL` (maksimal tanggal hari ini di `Asia/Jakarta`)
- `quantity`: `INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000)`
- `purchase_capital`: `NUMERIC(18,2) NOT NULL CHECK (purchase_capital BETWEEN 0 AND 9999999999.00)` (tanpa default)
- `shipping_capital`: `NUMERIC(18,2) NOT NULL CHECK (shipping_capital BETWEEN 0 AND 9999999999.00)` (tanpa default)
- `weight_sample_per_500`: `NUMERIC(12,2) NULLABLE CHECK (weight_sample_per_500 IS NULL OR weight_sample_per_500 BETWEEN 0.01 AND 100000.00)`
- `fish_size`: `VARCHAR(20) NOT NULL CHECK (fish_size IN ('2-4 cm', '3-5 cm', '4-6 cm', '5-7 cm', '6-8 cm', '7-9 cm', '8-10 cm', '9-11 cm', '10-12 cm'))`
- `created_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### 6. `incoming_fish_voids` _(Append-Only / Immutable)_

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `incoming_fish_id`: `UUID NOT NULL UNIQUE REFERENCES incoming_fish(id) ON DELETE RESTRICT`
- `reason`: `TEXT NOT NULL CHECK (reason <> '' AND TRIM(reason) <> '')`
- `voided_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `voided_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### 7. `idempotency_keys`

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `endpoint`: `VARCHAR(255) NOT NULL`
- `idempotency_key`: `UUID NOT NULL`
- `payload_hash`: `VARCHAR(64) NOT NULL` (SHA-256 dari payload bisnis ternormalisasi)
- `status`: `VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'completed'))`
- `response_status`: `INTEGER NULLABLE`
- `response_body`: `JSONB NULLABLE`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `completed_at`: `TIMESTAMPTZ NULLABLE`
- **Unique Index:** `CREATE UNIQUE INDEX idx_idempotency_user_endpoint_key ON idempotency_keys (user_id, endpoint, idempotency_key);`

#### 8. `audit_logs` _(Append-Only / Immutable)_

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `request_id`: `VARCHAR(255) NOT NULL`
- `actor_id`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `action`: `VARCHAR(50) NOT NULL` — pada migrasi Fase 7, constraint `CHECK` V4.5 diperbarui secara additive agar mencakup nilai V4.5 (`'CREATE_ENTRY'`, `'VOID_ENTRY'`) dan nilai POS (`'CREATE_SALE'`, `'VOID_SALE'`, `'CREATE_SALE_PRICE'`, `'UPDATE_SALE_PRICE'`) (`APPROVED — OWNER`, ADR 0002).
- `entity_type`: `VARCHAR(50) NOT NULL`
- `entity_id`: `UUID NOT NULL`
- `old_values`: `JSONB NULLABLE` _(Dipertahankan demi kompatibilitas penuh dengan layanan V4.5 yang berjalan; untuk `CREATE_SALE_PRICE` dan `UPDATE_SALE_PRICE`, dibiarkan `NULL` sesuai keputusan audit ringkas `TBD-02`.)_
- `new_values`: `JSONB NULLABLE` _(Dipertahankan demi kompatibilitas penuh dengan layanan V4.5 yang berjalan; untuk `CREATE_SALE_PRICE` dan `UPDATE_SALE_PRICE`, dibiarkan `NULL` sesuai keputusan audit ringkas `TBD-02`.)_
- `reason`: `TEXT NULLABLE`
- `ip_address`: `VARCHAR(45) NULLABLE`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

### 4.3 Skema Tabel Modul POS (`APPROVED — OWNER`, ADR 0002; belum diimplementasikan)

#### 9. `sale_daily_sequences` (`APPROVED — OWNER` — `TBD-05`)

Mengelola penomoran transaksi penjualan harian global tanpa batas maksimum $999$.

- `sale_date`: `DATE PRIMARY KEY` (berdasarkan tanggal transaksi pada zona waktu `Asia/Jakarta`)
- `last_number`: `BIGINT NOT NULL CHECK (last_number >= 0)`
- **Format Nomor Transaksi:** `PFI-SAL-YYYYMMDD-XXX`, dengan padding minimal 3 digit untuk angka $1\text{--}999$ (`001`--`999`) dan otomatis melebar untuk angka $\ge 1000$ (`1000`, `1001`, dst.).

#### 10. `fish_sale_prices` (`APPROVED — OWNER`, ADR 0002)

Menyimpan satu harga jual aktif per kombinasi spesies dan ukuran ikan (mutable/dapat ditimpa oleh `Owner` dan `Admin Operasional`, tanpa riwayat harga katalog).

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `species_id`: `UUID NOT NULL REFERENCES fish_species(id) ON DELETE RESTRICT`
- `fish_size`: `VARCHAR(20) NOT NULL` (menggunakan enum 9 ukuran standar V4.5)
- `price_per_fish`: `BIGINT NOT NULL CHECK (price_per_fish BETWEEN 1 AND 10000000)` (`APPROVED — OWNER` `TBD-01`) — menyimpan bilangan bulat Rupiah tanpa angka desimal sesuai aturan bisnis POS (`FR-PRICE-04`).
- `created_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `updated_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Constraint Unik:** `UNIQUE (species_id, fish_size)`
- **Kebijakan Audit (`TBD-02` — `APPROVED — OWNER`, amendemen ADR 0002):** Penambahan harga dicatat dengan `action = 'CREATE_SALE_PRICE'`; perubahan harga dengan `action = 'UPDATE_SALE_PRICE'`. Keduanya hanya menyimpan aktor (`actor_id`) dan waktu (`created_at`), tanpa `old_values` maupun `new_values`.

#### 11. `fish_sales` (`APPROVED — OWNER`, ADR 0002 — Append-Only)

Menyimpan transaksi penjualan satu batch secara lunas beserta _snapshot_ harga pada saat transaksi terjadi.

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `sale_code`: `VARCHAR(50) NOT NULL UNIQUE` (Format: `PFI-SAL-YYYYMMDD-XXX`, identitas internal, tidak dicetak di struk)
- `batch_id`: `UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT`
- `quantity`: `INTEGER NOT NULL CHECK (quantity > 0)` (satuan ekor)
- `unit_price`: `BIGINT NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000)` (snapshot harga Rupiah bulat per ekor saat transaksi)
- `total_amount`: `BIGINT NOT NULL CHECK (total_amount = quantity::BIGINT * unit_price)` (snapshot total Rupiah bulat)
- `payment_method`: `VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'transfer'))`
- `cash_received`: `BIGINT NULLABLE` (wajib $\ge \text{total\_amount}$ untuk `cash`; `NULL` untuk `transfer`)
- `change_amount`: `BIGINT NULLABLE` ($= \text{cash\_received} - \text{total\_amount}$ untuk `cash`; `NULL` untuk `transfer`)
- `created_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### 12. `fish_sale_voids` (`APPROVED — OWNER`, ADR 0002 — Append-Only)

Menyimpan pembatalan satu transaksi penjualan secara utuh tanpa mengubah atau menghapus baris pada `fish_sales`.

- `id`: `UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `sale_id`: `UUID NOT NULL UNIQUE REFERENCES fish_sales(id) ON DELETE RESTRICT` (memastikan 1 transaksi hanya dapat di-VOID 1 kali)
- `voided_by`: `UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `voided_at`: `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- _(Catatan: Tidak memiliki kolom `reason` wajib sesuai keputusan bisnis POS)._

### 4.4 Model Kalkulasi Stok & Transisi Status Batch

Stok tidak pernah disimpan sebagai angka statis yang dapat diedit manual, melainkan dihitung dari transaksi valid:

$$\text{Stok Batch} = \text{Total Penerimaan Valid} - \text{Total Penjualan Valid} - \text{Total Kematian Valid}$$

- **Total Penerimaan Valid:** Nilai `incoming_fish.quantity` untuk batch yang tidak memiliki baris pada `incoming_fish_voids`.
- **Total Penjualan Valid:** $\sum \text{fish\_sales.quantity}$ pada batch terkait yang `sale_id`-nya tidak tercatat pada `fish_sale_voids`.
- **Total Kematian Valid:** Bernilai $0$ pada cakupan MVP saat ini karena modul pencatatan kematian berstatus `OUT OF SCOPE`, namun service kalkulasi stok didesain modular agar siap menyertakan pengurangan kematian valid pada fase berikutnya.

`calculate_batch_stock(UUID)` diperluas untuk memasukkan sales yang belum di-VOID sesuai ADR 0002. Pengecekan checkout dan dependent transaction guard receiving VOID memakai row lock batch yang sama. Implementasi fungsi/trigger/grant tetap menunggu task database POS.

```mermaid
stateDiagram-v2
    [*] --> active : Penerimaan Valid Dibuat (1:1 Batch)
    active --> voided : VOID Penerimaan\n(Admin Operasional + Alasan Wajib +\nTanpa Transaksi Turunan)
    active --> completed : Penjualan Valid Membuat\nStok Batch == 0
    completed --> active : VOID Penjualan Membuat\nStok Batch > 0
    completed --> completed : VOID Penjualan tetapi\nStok Batch Tetap == 0
    voided --> [*] : Final (Tidak Dapat Diaktifkan Kembali)
```

---

## 4.5 Addendum V4.6 — Kesiapan Jual dan Katalog Multi-Produk (`APPROVED — OWNER`)

Addendum ini memperluas POS setelah MVP. Aturan V4.5 dan trigger siklus hidup batch tetap dipertahankan.

### Kesiapan jual batch

- `batches.status` tetap memiliki nilai `active`, `completed`, dan `voided`; tidak ada nilai budidaya baru yang dimasukkan ke kolom ini.
- Tambahkan `sale_readiness VARCHAR(20) NOT NULL DEFAULT 'BELUM_SIAP' CHECK (sale_readiness IN ('BELUM_SIAP', 'SIAP_JUAL'))`. Nilai awal batch lama maupun baru adalah `BELUM_SIAP`.
- `sale_readiness` tidak mengubah, menggantikan, atau memperlonggar `guard_batch_status_transition()` V4.5. Batch dapat dijual hanya jika `status = 'active'`, kesiapan `SIAP_JUAL`, dan stok hasil hitung lebih dari nol.
- `batch_sale_readiness_histories` adalah tabel append-only dengan `id UUID`, `batch_id UUID` FK ke `batches`, `from_readiness` nullable, `to_readiness`, `changed_by UUID` FK ke `users`, `note VARCHAR` nullable, dan `created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`. Setiap perubahan kesiapan dan penulisan histori terjadi dalam satu transaksi.
- Backend membatasi perubahan kesiapan ke `Owner` dan `Kepala Budidaya`; actor selalu berasal dari JWT. Runtime tidak boleh UPDATE/DELETE tabel histori.

### Kategori dan produk POS

- Tambahkan `product_categories`: UUIDv4, nama unik, kode/slug unik, `requires_batch`, `is_active`, serta `created_at`/`updated_at`. Kategori awal dapat meliputi Benih Ikan, Ikan Konsumsi, Pakan & Nutrisi, Obat & Probiotik, dan Sarana Budidaya.
- Tambahkan `products`: UUIDv4, `category_id`, SKU unik, nama, `tracking_mode` (`BATCH_TRACKED` atau `NON_BATCH`), `species_id` nullable yang merujuk ke `fish_species`, `fish_size` nullable, `unit`, `unit_price NUMERIC(12,2) CHECK (unit_price > 0 AND unit_price <= 10000000.00)`, `stock_quantity NUMERIC(12,2)` nullable untuk `NON_BATCH`, `is_active`, serta `created_at`/`updated_at`.
- Produk `BATCH_TRACKED` wajib konsisten dengan kategori `requires_batch = true`, species dan ukuran terisi, dan stok diperoleh dari agregasi batch `active`/`SIAP_JUAL`; produk `NON_BATCH` harus `requires_batch = false`, tidak menunjuk batch, dan memakai stok produk langsung. Invariant ini ditegakkan backend dan database sesuai kemampuan constraint.
- Produk/kategori diarsipkan dengan `is_active = false`, bukan dihapus. Mutasi katalog memakai aktor JWT, RBAC Owner/Admin Operasional, transaksi atomik, dan audit append-only. Nama action audit khusus V4.6 dikunci di P8-02 sebelum penerapan.

### Transaksi dan kompatibilitas

- `fish_sales` tetap append-only. Tambahkan `product_id` nullable FK ke `products` untuk menjaga data lama; transaksi baru wajib memiliki produk. Ubah `batch_id` menjadi nullable: wajib untuk `BATCH_TRACKED`, harus NULL untuk `NON_BATCH`.
- Nomor harian `sale_daily_sequences` dan sembilan field struk resmi tetap dipertahankan. Harga katalog dua-desimal memerlukan snapshot nominal yang dapat menyimpan dua desimal; P8-01 harus melakukan migrasi tipe secara non-destruktif dengan mempertahankan nilai histori V4.5.
- Untuk `BATCH_TRACKED`, pembuatan penjualan mengunci batch dengan `SELECT ... FOR UPDATE`, lalu memvalidasi ulang status aktif, kesiapan `SIAP_JUAL`, stok, harga, dan pembayaran sebelum insert. Untuk `NON_BATCH`, backend mengunci baris produk dan memvalidasi stok produk pada transaksi yang sama.
- VOID tetap berupa reversal append-only. Pemulihan stok `NON_BATCH` dan aturan jumlah desimal per unit harus ditetapkan dan diuji di P8-02 sebelum backend dirilis. Pemetaan struk mengikuti sembilan slot kanonis pada Bagian 7.2 dan response create-sale/cetak ulang harus identik.
- Endpoint V4.6 untuk membuat penjualan adalah `POST /api/v1/sales`. Detail request/response, route katalog, audit action, idempotency, dan kompatibilitas dengan route V4.5 `/api/v1/pos/*` dikunci di P8-02; kontrak V4.5 tetap menjadi acuan bagi klien lama selama transisi.

## 5. Alur Data dan Mekanisme Transaksi Atomik

### 5.1 Alur Penerimaan Ikan (`POST /api/v1/fish-entries` — `LOCKED — V4.5`)

1. **Auth & RBAC Check:** Validasi JWT, status aktif akun, dan role (`Admin Operasional` atau `Kepala Budidaya`).
2. **Validasi Input & Zona Waktu:** Validasi payload JSON, batas numerik, enum `fish_size`, serta `entry_date` $\le$ tanggal hari ini di `Asia/Jakarta`. Kegagalan pada tahap 1--2 mengembalikan HTTP `400`/`401`/`403`/`422` tanpa mengonsumsi `Idempotency-Key`.
3. **Normalisasi & SHA-256 Hash:** Hapus properti `null` secara rekursif, urutkan key objek secara alfabetis ($\text{A--Z}$), pangkas _trailing zeros_ pada 3 field desimal (`purchase_capital`, `shipping_capital`, `weight_sample_per_500`), lalu hitung hash `SHA-256`.
4. **Begin Transaction & Idempotency Lock:** `INSERT` ke `idempotency_keys` (`status = 'processing'`). Jika konflik pada `(user_id, endpoint, idempotency_key)`:
   - Jika transaksi sebelumnya `completed` dengan `payload_hash` identik $\rightarrow$ kembalikan respons _cached_.
   - Jika `payload_hash` berbeda $\rightarrow$ tolak dengan HTTP `409 IDEMPOTENCY_MISMATCH`.
5. **Validasi Spesies Aktif:** Pastikan `species_id` ada di `fish_species` dengan `is_active = true` (jika tidak, rollback $\rightarrow$ `422 SPECIES_NOT_ACTIVE`).
6. **Alokasi Sequence Harian Atomik:** Jalankan `INSERT INTO batch_daily_sequences ... ON CONFLICT DO NOTHING` diikuti `UPDATE ... SET last_number = last_number + 1 WHERE entry_date = :entry_date AND last_number < 999 RETURNING last_number`. Jika $0$ baris ter-update $\rightarrow$ rollback dan kembalikan `422 BATCH_SEQUENCE_EXHAUSTED`.
7. **Insert Batch & Penerimaan:** Simpan ke `batches` (`status = 'active'`) dan `incoming_fish` dengan `created_by` dari JWT.
8. **Write Audit Log:** Simpan ke `audit_logs` dengan `action = 'CREATE_ENTRY'`.
9. **Finalize Idempotency & Commit:** Perbarui `idempotency_keys` ke `'completed'`, simpan `response_status` dan `response_body`, lalu `COMMIT` (memicu evaluasi _Deferred Constraint Trigger_ relasi $1:1$).

### 5.2 Alur VOID Penerimaan (`POST /api/v1/fish-entries/{batch_id}/void` — `LOCKED — V4.5`)

1. **Auth & RBAC Check:** Pastikan role pengguna adalah `Admin Operasional`.
2. **Validasi Alasan & Idempotency Lock:** Pastikan `reason` tidak kosong, lalu mulai transaksi database dan kunci `idempotency_keys`.
3. **Master Row Locking:** Eksekusi `SELECT * FROM batches WHERE id = :batch_id FOR UPDATE`. Jika tidak ditemukan $\rightarrow$ `404 BATCH_NOT_FOUND`.
4. **Verifikasi Status:** Pastikan `batches.status = 'active'`. Jika tidak $\rightarrow$ `409 BATCH_NOT_ACTIVE`.
5. **Pengecekan Transaksi Turunan:** Pastikan batch belum memiliki record penjualan (`fish_sales`) maupun transaksi turunan lain. Jika ada $\rightarrow$ rollback dan kembalikan `409 HAS_DEPENDENT_TRANSACTIONS`.
6. **Insert Reversal & Update Status:** Simpan baris baru ke `incoming_fish_voids` (tanpa mengubah/menghapus `incoming_fish`), ubah `batches.status = 'voided'`, dan tulis `audit_logs` (`action = 'VOID_ENTRY'`).
7. **Finalize Idempotency & Commit:** Selesaikan `idempotency_keys` dan `COMMIT` transaksi.

### 5.3 Alur Transaksi Penjualan Kasir / POS (`LOCKED — BUSINESS` | Kontrak API `APPROVED — OWNER`, ADR 0002)

```mermaid
sequenceDiagram
    actor Kasir as Kasir / Admin / Owner
    participant UI as Frontend POS
    participant API as Backend REST API
    participant DB as PostgreSQL 13+
    participant Printer as Printer Thermal (58/80mm)

    Kasir->>UI: Buka POS & Pilih 1 Batch Aktif (Stok > 0)
    UI->>API: Refresh Stok & Harga Terkini Batch
    API->>DB: Query Stok Valid & fish_sale_prices
    DB-->>API: Stok Terkini + Harga Per Ekor
    API-->>UI: Data Batch & Harga Terbaru
    Kasir->>UI: Input Quantity (Ekor) & Konfirmasi Harga
    Note over UI: Jika qty > stok, batasi ke stok & minta konfirmasi.\nJika harga berubah, minta konfirmasi ulang.
    Kasir->>UI: Pilih Pembayaran Lunas (Tunai >= Total / Konfirmasi Transfer)
    UI->>API: POST /api/v1/pos/sales + JWT + Idempotency-Key (UUIDv4)
    API->>DB: BEGIN TRANSACTION + Idempotency Lock
    API->>DB: SELECT * FROM batches WHERE id = :batch_id FOR UPDATE
    API->>DB: Validasi Ulang Status 'active', Stok >= qty, Harga Terkini, & Pembayaran
    API->>DB: Alokasi sale_daily_sequences (BIGINT tanpa batas 999)
    API->>DB: INSERT fish_sales (Snapshot Harga & Total)
    API->>DB: Jika Stok Baru == 0 -> UPDATE batches SET status = 'completed'
    API->>DB: INSERT audit_logs (action = 'CREATE_SALE') + Finalize Idempotency
    DB-->>API: COMMIT Sukses
    API-->>UI: HTTP 201 Created (Data Penjualan & Struk)
    UI->>Printer: Auto-Print Struk (ESC/POS BT atau Web USB/Browser)
    alt Printer Gagal / Terputus
        Printer-->>UI: Error Koneksi Printer
        UI-->>Kasir: Transaksi Tetap Sukses + Opsi Cetak Ulang (Hanya Pembuat)
    end
```

### 5.4 Alur VOID Penjualan & Pengelolaan Harga

- **VOID Penjualan (`LOCKED — BUSINESS`):**
  1. Role POS (`Owner`, `Admin Operasional`, atau `Kasir`) mengonfirmasi pembatalan utuh pada transaksi yang belum di-VOID (tanpa input alasan wajib).
  2. Backend memulai transaksi ACID dengan `Idempotency-Key`, mengunci baris batch terkait (`SELECT ... FOR UPDATE`), dan memverifikasi penjualan belum tercatat di `fish_sale_voids`.
  3. Backend menyisipkan reversal ke `fish_sale_voids` (`sale_id`, `voided_by`, `voided_at`) tanpa mengubah `fish_sales`.
  4. Backend menghitung ulang stok valid batch: jika stok kembali $> 0$ dan status batch sebelumnya `'completed'`, status batch dikembalikan menjadi `'active'` (batch `'voided'` tidak pernah diaktifkan kembali).
  5. Backend menulis `audit_logs` dengan `action = 'VOID_SALE'`, menyelesaikan idempotency, dan melakukan `COMMIT`.
- **Pengelolaan Harga (`APPROVED — OWNER` untuk `TBD-01` & `TBD-02`):**
  1. Hanya `Owner` dan `Admin Operasional` yang dapat menambah atau memperbarui harga per `(species_id, fish_size)` dengan nilai Rupiah bulat $1 \le \text{price\_per\_fish} \le 10.000.000$.
  2. Backend menambah/memperbarui `fish_sale_prices` dan menulis `audit_logs` dengan `action = 'CREATE_SALE_PRICE'`/`'UPDATE_SALE_PRICE'` yang hanya mencatat `actor_id` dan `created_at` (`old_values = NULL`, `new_values = NULL`).
  3. Perubahan harga tidak pernah memengaruhi kolom `unit_price` maupun `total_amount` pada transaksi lama di `fish_sales`.

---

## 6. Arsitektur Kontrak API

### 6.1 Endpoint Terkunci V4.5 (`LOCKED — V4.5`)

| Method | Endpoint                               | Hak Akses                              | Idempotency             | Keterangan                                                                          |
| ------ | -------------------------------------- | -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `POST` | `/api/v1/fish-entries`                 | `Admin Operasional`, `Kepala Budidaya` | Wajib ($\text{UUIDv4}$) | Membuat batch baru dan penerimaan ikan secara atomik (`201 Created`).               |
| `POST` | `/api/v1/fish-entries/{batch_id}/void` | `Admin Operasional`                    | Wajib ($\text{UUIDv4}$) | Membatalkan penerimaan dengan alasan wajib jika tanpa transaksi turunan (`200 OK`). |

- **Kode Error Standar V4.5:** `400 INVALID_PAYLOAD`, `400 INVALID_IDEMPOTENCY_KEY`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 BATCH_NOT_FOUND`, `409 IDEMPOTENCY_MISMATCH`, `409 BATCH_NOT_ACTIVE`, `409 HAS_DEPENDENT_TRANSACTIONS`, `422 SPECIES_NOT_ACTIVE`, `422 INVALID_ENTRY_DATE`, `422 BATCH_SEQUENCE_EXHAUSTED`, `429 RATE_LIMIT_EXCEEDED`, `500 INTERNAL_SERVER_ERROR`, `503 DATABASE_LOCK_TIMEOUT`, `503 DATABASE_UNAVAILABLE`.
- **Catatan Idempotency & Konkurensi POS (ADR 0002):** Verifikasi stok dan harga dilakukan setelah `SELECT ... FOR UPDATE`. Konflik `PRICE_CHANGED` atau `INSUFFICIENT_STOCK` me-rollback transaksi termasuk baris idempotency; setelah nilai terbaru disetujui, klien memakai key UUIDv4 baru. Detail kontrak ada di `docs/pos-api-contract.md`.
- **Endpoint Baca Pendukung PRD (`PG-01`, `PG-02`, `PG-04`, `PG-06`):** Endpoint autentikasi login, daftar/detail penerimaan & batch, serta pembacaan `audit_logs` (khusus `Owner`, `Admin Operasional`, `Kepala Budidaya`) mengikuti pola REST JSON standar di bawah `/api/v1`.

### 6.2 Endpoint Modul POS (`APPROVED — OWNER`, ADR 0002)

Kontrak request/response, pagination, RBAC, idempotency, serta error normatif dicatat dalam [docs/pos-api-contract.md](docs/pos-api-contract.md). Tabel berikut merangkum route yang telah disetujui; implementasinya tetap mengikuti urutan task dan gate proyek.

| Method  | Kandidat Endpoint                     | Hak Akses                             | Fungsi Konseptual                                                                                                 |
| ------- | ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/pos/batches`                 | `Owner`, `Admin Operasional`, `Kasir` | Mengambil daftar batch `active` dengan stok valid $> 0$ beserta harga jual jika tersedia.                         |
| `GET`   | `/api/v1/pos/batches/{batch_id}`      | `Owner`, `Admin Operasional`, `Kasir` | Memuat ulang stok terkini dan harga terbaru batch sebelum konfirmasi transaksi.                                   |
| `GET`   | `/api/v1/pos/prices`                  | `Owner`, `Admin Operasional`, `Kasir` | Membaca daftar harga aktif per spesies dan ukuran.                                                                |
| `POST`  | `/api/v1/pos/prices`                  | `Owner`, `Admin Operasional`          | Menambahkan harga baru untuk kombinasi `(species_id, fish_size)` yang belum ada (`Idempotency-Key` UUIDv4 wajib). |
| `PATCH` | `/api/v1/pos/prices/{price_id}`       | `Owner`, `Admin Operasional`          | Mengubah harga aktif yang sudah ada dan mencatat audit `UPDATE_SALE_PRICE` (`Idempotency-Key` UUIDv4 wajib).      |
| `POST`  | `/api/v1/pos/sales`                   | `Owner`, `Admin Operasional`, `Kasir` | Menyimpan transaksi penjualan lunas secara atomik (`Idempotency-Key` wajib).                                      |
| `GET`   | `/api/v1/pos/sales`                   | `Owner`, `Admin Operasional`, `Kasir` | Menampilkan histori dengan pagination/filter ADR 0001.                                                            |
| `GET`   | `/api/v1/pos/sales/{sale_id}`         | `Owner`, `Admin Operasional`, `Kasir` | Menampilkan detail transaksi penjualan beserta status aktif/VOID.                                                 |
| `POST`  | `/api/v1/pos/sales/{sale_id}/void`    | `Owner`, `Admin Operasional`, `Kasir` | Membatalkan seluruh transaksi penjualan (`Idempotency-Key` wajib, tanpa alasan wajib).                            |
| `GET`   | `/api/v1/pos/sales/{sale_id}/receipt` | Pembuat Transaksi (`created_by`)      | Mengambil data struk untuk cetak ulang (ditolak jika bukan pembuat atau transaksi sudah VOID).                    |

---

## 7. Layanan Eksternal dan Integrasi Perangkat

### 7.1 Kebijakan API Pihak Ketiga Eksternal

- **Status:** **Tidak Ada Integrasi Eksternal (`OUT OF SCOPE`)**.
- Sistem PFI beroperasi secara mandiri tanpa ketergantungan pada API pihak ketiga seperti _payment gateway_, sistem akuntansi/ERP, layanan CRM, maupun layanan analitik eksternal.
- Pembayaran transfer pada kasir dicatat melalui mekanisme konfirmasi manual oleh kasir bahwa dana telah diterima tanpa integrasi mutasi bank otomatis maupun input nomor referensi wajib.

### 7.2 Arsitektur Pencetakan Struk Thermal (`APPROVED — OWNER`, ADR 0002)

Pencetakan struk dijalankan sepenuhnya pada **sisi klien (Client-Side Printing)** dengan prinsip **Decoupled Commit-and-Print**:

1. **Pemisahan Status Transaksi dan Printer (`FR-PRINT-04`):**
   - Transaksi penjualan di-`COMMIT` ke PostgreSQL terlebih dahulu sebelum perintah cetak dijalankan.
   - Kegagalan koneksi printer atau kertas habis **tidak pernah** membatalkan transaksi penjualan dan tidak boleh memicu pengiriman ulang request `POST /api/v1/pos/sales`.
2. **Jalur Baseline Multi-Platform (`APPROVED — OWNER`):** Browser print dengan layout CSS untuk lebar 58 mm dan 80 mm menjadi baseline melalui dialog cetak sistem tanpa driver/protokol printer khusus aplikasi. Target desktop mencakup Linux Pop!\_OS dan Windows; OS tetap mungkin memerlukan driver atau dukungan printer native sehingga ini bukan jaminan zero-driver universal. Perangkat mobile/tablet menggunakan dialog cetak sistem apabila didukung kombinasi OS, browser, dan printer. Direct ESC/POS Bluetooth, WebUSB, Web Serial, native wrapper, dan print bridge tidak termasuk baseline ADR 0002.
   - **Verifikasi fisik GPOS-04:** Merek/model printer dan kombinasi perangkat tetap harus diuji sebelum dukungan aktual diklaim. Keputusan arsitektur browser print telah disetujui; kompatibilitas perangkat tertentu belum diverifikasi.
3. **Konten Struk & Otorisasi Cetak Ulang (`FR-PRINT-01` s.d. `FR-PRINT-05`):**
   - Struk memiliki tepat sembilan slot berurutan: (1) Nama Perusahaan `PT. Pisciculture Farm Indonesia` (`company_name`); (2) Tanggal & Waktu Transaksi (`transaction_date_time`); (3) Jenis Ikan/Produk (`species_name` untuk `BATCH_TRACKED`, `product.name` untuk `NON_BATCH`); (4) Ukuran/Kode Varian (`fish_size` untuk `BATCH_TRACKED`, `product.sku` untuk `NON_BATCH`); (5) Jumlah dan unit produk (`quantity` + `unit`) sebagai satu slot; (6) Harga Satuan (`unit_price`); (7) Total Pembayaran (`total_price`); (8) Metode Pembayaran (`CASH` atau `TRANSFER`); dan (9) Nama Kasir (`cashier_name`). Tidak ada slot Kode Batch terpisah.
   - Response penjualan baru dan cetak ulang wajib mengembalikan struktur sembilan slot dengan field, tipe, urutan, dan pemetaan yang identik.
   - **Dilarang mencetak:** Nomor penjualan internal (`PFI-SAL-...`), kode batch (`PFI-BCH-...`), data pelanggan, referensi transfer, maupun status/alasan VOID.
   - **Otorisasi Cetak Ulang:** Hanya dapat dijalankan oleh akun pembuat transaksi (`fish_sales.created_by == jwt.user_id`) dan hanya apabila transaksi belum memiliki catatan di `fish_sale_voids`.

---

## 8. Non-Functional Requirements dan Target Kinerja

- **Performa Penerimaan (`NFR-PERF-01` — `LOCKED — V4.5`):** Minimal $95\%$ permintaan ($p95$) penyimpanan penerimaan ikan (`POST /api/v1/fish-entries`) harus memperoleh respons dalam waktu $\le 1,5\text{ detik}$ pada uji beban $50$ _concurrent requests_ di lingkungan _staging_ (spesifikasi minimal $2\text{ vCPU}$, $4\text{ GB RAM}$, dengan populasi database minimal $100.000$ _records_).
- **Kontrol Konkurensi (`NFR-TRANS-03`):** Penguncian tingkat baris (`SELECT ... FOR UPDATE`) pada tabel `batches` menjamin operasi penjualan bersamaan maupun persaingan antara VOID dan penjualan pada batch yang sama ter-serialisasi tanpa menyebabkan stok negatif (_overselling_).
- **Integritas Audit & Idempotency (`NFR-TRANS-01`, `NFR-TRANS-02`):** Kegagalan penulisan `audit_logs` memicu _rollback_ penuh transaksi bisnis; pengiriman ulang request jaringan dengan `Idempotency-Key` ($\text{UUIDv4}$) dan payload identik mengembalikan respons tersimpan tanpa duplikasi data.

---

## 9. Pelacakan Keputusan Terbuka (`TBD`) dan Gerbang Implementasi

Tabel berikut merangkum seluruh item `TBD` dari PRD/Blueprint beserta status terkininya setelah keputusan arsitektur pemilik produk:

| ID       | Topik                                  | Status Terkini                          | Keputusan / Tindakan yang Diperlukan                                                                                                                                                                                                   |
| -------- | -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TBD-01` | Batas maksimum harga per ekor          | `APPROVED — OWNER`                      | Ditetapkan minimum $\text{Rp } 1$ dan maksimum $\text{Rp } 10.000.000$ per ekor menggunakan `BIGINT` (bilangan bulat Rupiah tanpa desimal).                                                                                            |
| `TBD-02` | Audit perubahan daftar harga           | `APPROVED — OWNER`                      | Tambah harga memakai `CREATE_SALE_PRICE`; ubah harga memakai `UPDATE_SALE_PRICE`. Keduanya hanya mencatat aktor/waktu (`old_values` & `new_values` kosong), sesuai amendemen ADR 0002.                                                 |
| `TBD-03` | Arsitektur cetak thermal               | `APPROVED — OWNER` (ADR 0002)           | Browser print CSS 58/80 mm dan dialog sistem menjadi baseline; GPOS-04 tetap wajib untuk menguji printer/perangkat fisik sebelum klaim kompatibilitas.                                                                                 |
| `TBD-04` | Kontrak API POS final                  | `APPROVED — OWNER` (ADR 0002)           | Route `/api/v1/pos/*`, envelope, payload, error, RBAC, idempotency, dan list contract normatif ada di `docs/pos-api-contract.md`.                                                                                                      |
| `TBD-05` | Sequence penjualan harian              | `APPROVED — OWNER`                      | Tabel `sale_daily_sequences` dengan tipe `BIGINT` disetujui sebagai desain final tanpa batas $999$.                                                                                                                                    |
| `TBD-06` | Audit action & privilege POS           | `APPROVED — OWNER` (ADR 0002)           | Empat tabel POS, computed stock, trigger, dependent transaction guard, action audit, index, dan granular runtime privileges dikunci untuk implementasi sesuai ADR 0002.                                                                |
| `TBD-07` | Hak Audit Log untuk Kasir              | `APPROVED — OWNER`                      | Role `Kasir` dilarang (`Forbidden`) mengakses data maupun halaman Audit Log.                                                                                                                                                           |
| `TBD-08` | Pengelolaan & provisioning akun        | `PARTIALLY RESOLVED — OWNER` (ADR 0001) | Akun awal `Owner` lokal diprovision melalui CLI idempoten dari `.env`, tanpa registrasi publik dan tanpa mengubah akun yang sudah ada. Deaktivasi, perubahan role, reset password, dan administrasi akun tetap `TBD — NEEDS DECISION`. |
| `TBD-09` | Pagination & filter daftar             | `APPROVED — OWNER` (ADR 0001)           | `page=1`, `limit=20`, maksimum `100`; filter `startDate`/`endDate` ISO 8601 pada timestamp utama dan `status` hanya untuk enum resmi; urutan terbaru dahulu (`DESC`). Search dan arbitrary sort tidak termasuk keputusan ini.          |
| `TBD-09` | Filter, pencarian, & pagination daftar | `TBD — NEEDS DECISION`                  | Parameter filter, sorting, dan pagination untuk daftar batch dan daftar penjualan perlu dikunci sebelum implementasi endpoint daftar.                                                                                                  |

## Addendum Arsitektur V4.6 — Skema Database, Guardrails, & Concurrency

### 1. Prinsip Kompatibilitas V4.5 -> V4.6

- **Trigger Status Batch V4.5 Dipertahankan:** Kolom `batches.status` (`active`, `completed`, `voided`) beserta trigger `batches_status_transition_guard` **tidak diubah**. Kesiapan jual dipisahkan ke kolom `batches.sale_readiness` (`BELUM_SIAP` | `SIAP_JUAL`, default `BELUM_SIAP`).
- **Tabel `fish_sales` Tetap Append-Only:** Trigger `fish_sales_immutable` dipertahankan. Kolom `total_amount` di-rename secara _in-place_ (non-destruktif) menjadi `total_price` bertipe `NUMERIC(14,2)`, kolom `product_id` ditambahkan (nullable untuk histori V4.5), dan `batch_id` diubah menjadi nullable (`NULL` khusus transaksi `NON_BATCH`).

### 2. Spesifikasi Perubahan Tabel & Constraints

1. **`batches` (Perluasan):**
   - `sale_readiness`: Enum `SaleReadiness` (`BELUM_SIAP`, `SIAP_JUAL`), `NOT NULL DEFAULT 'BELUM_SIAP'`.
2. **`batch_sale_readiness_histories` (Baru — Append-Only):**
   - `id` (`UUID` PK), `batch_id` (`UUID` FK -> `batches.id`), `from_readiness` (`SaleReadiness` NULL), `to_readiness` (`SaleReadiness` NOT NULL), `changed_by` (`UUID` FK -> `users.id`), `note` (`VARCHAR(500)` NULL), `created_at` (`TIMESTAMPTZ` DEFAULT `now()`).
   - Dilindungi trigger `batch_sale_readiness_histories_immutable` yang menolak `UPDATE` dan `DELETE`.
3. **`product_categories` (Baru):**
   - `id` (`UUID` PK), `name` (`VARCHAR(100)` UNIQUE), `code` (`VARCHAR(50)` UNIQUE), `requires_batch` (`BOOLEAN` NOT NULL), `is_active` (`BOOLEAN` DEFAULT `true`), `created_at`, `updated_at`.
4. **`products` (Baru — Evolusi dari `fish_sale_prices`):**
   - `id` (`UUID` PK), `category_id` (`UUID` FK -> `product_categories.id`), `sku` (`VARCHAR(64)` UNIQUE), `name` (`VARCHAR(150)` NOT NULL), `tracking_mode` (`ProductTrackingMode`: `BATCH_TRACKED` | `NON_BATCH`), `species` (`VARCHAR(100)` NULL), `size_label` (`VARCHAR(50)` NULL), `unit` (`VARCHAR(30)` NOT NULL), `unit_price` (`NUMERIC(12,2)` NOT NULL), `stock_quantity` (`NUMERIC(12,2)` NULL), `is_active` (`BOOLEAN` DEFAULT `true`), `created_at`, `updated_at`.
   - **Check Constraint:**
     - `unit_price > 0 AND unit_price <= 10000000`
     - Jika `tracking_mode = 'BATCH_TRACKED'`: `species IS NOT NULL AND size_label IS NOT NULL AND stock_quantity IS NULL`
     - Jika `tracking_mode = 'NON_BATCH'`: `species IS NULL AND size_label IS NULL AND stock_quantity IS NOT NULL AND stock_quantity >= 0`
   - **Partial Unique Index:** `CREATE UNIQUE INDEX products_active_batch_species_size_key ON products (species, size_label) WHERE is_active = true AND tracking_mode = 'BATCH_TRACKED';`
5. **Grants Role Runtime (`pfi_app_runtime`):**
   - `SELECT, INSERT` pada `product_categories`, `products`, `batch_sale_readiness_histories`, `audit_logs`.
   - `UPDATE` terbatas hanya pada kolom mutabel (`name`, `code`, `requires_batch`, `is_active`, `updated_at` pada `product_categories`; `category_id`, `sku`, `name`, `species`, `size_label`, `unit`, `unit_price`, `stock_quantity`, `is_active`, `updated_at` pada `products`; `sale_readiness` pada `batches`). Tanpa hak `DELETE`.

### 3. Alur Penguncian Transaksi (`POST /api/v1/sales`)

1. Kunci baris `products` (`SELECT ... FOR UPDATE`) dan validasi `is_active = true`.
2. Jika `tracking_mode === 'BATCH_TRACKED'`:
   - Validasi `batch_id` wajib ada; kunci baris `batches` (`SELECT ... FOR UPDATE`).
   - Validasi `status = 'active'`, `sale_readiness = 'SIAP_JUAL'`, `species` & `size_label` cocok dengan produk, dan `current_stock >= quantity`.
   - Kurangi `batches.current_stock` (jika menjadi `0`, transisi otomatis ke `completed` tetap mengikuti trigger V4.5).
3. Jika `tracking_mode === 'NON_BATCH'`:
   - Validasi `batch_id` tidak dikirim / `NULL`, dan `products.stock_quantity >= quantity`.
   - Kurangi `products.stock_quantity`.
4. Hitung `total_price = unit_price * quantity` (presisi `NUMERIC(14,2)`), generate nomor struk harian (`sale_daily_sequences`), simpan baris ke `fish_sales`, dan catat ke `audit_logs`.

### Aturan Penyelarasan & Anti-Konflik V4.5 ↔ V4.6 (Wajib Dipatuhi)

1. **Integritas Siklus Batch V4.5:**
   - Trigger `batches_status_transition_guard` (`active` -> `completed` | `voided`) dan logika otomatis `current_stock == 0` -> `status = 'completed'` tetap berlaku mutlak.
   - Gerbang jual kasir menggunakan kondisi majemuk wajib: `batches.status = 'active' AND batches.sale_readiness = 'SIAP_JUAL' AND batches.current_stock > 0`.
   - Batch dengan status `completed` atau `voided` terkunci permanen dan tidak boleh diubah `sale_readiness`-nya (`422 BATCH_NOT_ACTIVE`).

2. **Disiplin Tipe Kuantitas & Nominal:**
   - Item `BATCH_TRACKED` (ikan): `quantity` wajib bilangan bulat (`INTEGER >= 1`), `unit_price` wajib bilangan bulat Rupiah (`> 0` dan `<= 10.000.000`).
   - Item `NON_BATCH` (produk umum): `quantity` mendukung desimal hingga 2 angka di belakang koma (`NUMERIC(12,2) > 0`), `unit_price` maksimal `NUMERIC(12,2)` (`> 0` dan `<= 10.000.000`).
   - Total transaksi `fish_sales.total_price` menggunakan `NUMERIC(14,2)` tanpa menghapus atau mengubah baris histori transaksi V4.5 (`fish_sales` tetap _append-only_).

3. **Single Source of Truth Katalog:**
   - Tabel `products` adalah satu-satunya sumber aktif harga dan katalog POS. Tabel lama `fish_sale_prices` dibekukan (_read-only_) hanya untuk referensi migrasi histori; seluruh endpoint harga (`/pos/prices` maupun `/pos/products`) membaca dan menulis ke `products`.

4. **Integritas Audit Logs & Idempotency:**
   - Kolom `old_values` dan `new_values` pada `audit_logs` tetap dipertahankan sebagai kolom opsional (`JSONB NULLABLE`) demi kompatibilitas penuh dengan layanan V4.5 yang sudah berjalan. Jejak detail perubahan `BELUM_SIAP` <-> `SIAP_JUAL` dicatat pada tabel khusus _append-only_ `batch_sale_readiness_histories`.
   - Seluruh endpoint mutasi V4.6 (`PATCH /batches/:id/sale-readiness`, `POST/PATCH/DELETE /pos/products`, `POST/PATCH /pos/categories`) wajib memvalidasi header `Idempotency-Key` (UUIDv4) dan menggunakan zona waktu bisnis `Asia/Jakarta`.

5. **Pemetaan Deterministik Struk Thermal 9 Field:**
   - Jumlah dan urutan **9 field resmi struk** pada layar detail transaksi dan printer ESC/POS 58mm/80mm tidak boleh berubah.
   - Untuk transaksi `NON_BATCH` (`batch_id = NULL`), slot Jenis Ikan/Produk memuat `product.name` dan slot Ukuran/Kode Varian memuat `product.sku`; tidak ada slot Kode Batch terpisah dan tidak boleh ada nilai `null`.
   - Serializer response penjualan baru dan cetak ulang wajib identik untuk seluruh sembilan slot tersebut.
