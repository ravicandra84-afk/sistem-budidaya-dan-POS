# DOKUMEN UTAMA GABUNGAN PFI

## Master Blueprint & API Contract: Penerimaan Ikan dan Kasir/POS

**Status:** Dokumen V4.5 asli dipertahankan apa adanya; rancangan POS ditambahkan sebagai perluasan MVP.

**Cakupan:**

- Modul Penerimaan Ikan & VOID berdasarkan Master Blueprint V4.5.
- Modul Ikan Keluar (Kasir/POS) berdasarkan seluruh keputusan bisnis yang telah dikonfirmasi.

**Cara membaca dokumen:**

1. Bagian I adalah sumber V4.5. Teksnya disalin langsung dari dokumen sumber tanpa konversi format atau perubahan isi.
2. Bagian II adalah perluasan untuk Ikan Keluar (Kasir/POS). Keputusan teknis TBD-03, TBD-04, dan TBD-06 telah disetujui melalui [ADR 0002](docs/adr/0002-pos-gate-architecture.md); kontrak API normatif berada di [docs/pos-api-contract.md](docs/pos-api-contract.md). Uji perangkat fisik GPOS-04 tetap wajib sebelum klaim kompatibilitas.
3. Aturan VOID penerimaan pada V4.5 tetap memerlukan alasan dan tetap tunduk pada aturan transaksi turunan. Aturan VOID penjualan POS adalah aturan terpisah: tidak memerlukan alasan dan membatalkan satu transaksi penjualan secara utuh.
4. Penambahan POS tidak menghapus atau menggantikan aturan penerimaan, identitas batch 1:1, computed stock, append-only, RBAC, idempotency, ACID, dan audit pada V4.5.

---

# BAGIAN I — MASTER BLUEPRINT V4.5 ASLI

# 📘 MASTER BLUEPRINT & API CONTRACT (MAIN SSOT)

## Sistem Manajemen Akuakultur PFI (Pisciculture Farm Indonesia) — Modul MVP: Penerimaan Ikan & VOID

- **Versi Dokumen:** V4.5 (Final Locked - Single Source of Truth)
- **Status:** Disetujui untuk Implementasi Sprint 1
- **Database Engine:** PostgreSQL 13+
- **Zona Waktu Bisnis:** Asia/Jakarta ($\text{UTC}+7$)

---

## 1. Ringkasan Keputusan Arsitektur (Architectural Decision Records)

Dokumen ini mengunci seluruh keputusan bisnis dan teknis dari proses iterasi V1 hingga V4.5:

1. **Identitas Batch Absolut ($1:1$):** Setiap satu transaksi penerimaan fisik ikan wajib membentuk tepat satu _batch_ baru. Penggabungan beberapa penerimaan ke dalam satu _batch_ tidak diperbolehkan.
2. **Homogenitas Batch:** Satu _batch_ hanya boleh memuat **1 Spesies Ikan** dan **1 Kategori Ukuran**. Pengiriman fisik yang berisi spesies atau ukuran berbeda wajib dipecah menjadi transaksi dan _batch_ terpisah.
3. **Imutabilitas Data Transaksi (Append-Only):** Data pada `incoming_fish`, `incoming_fish_voids`, dan `audit_logs` bersifat _immutable_ setelah di-_commit_. Pembatalan tidak menggunakan _soft delete_, melainkan mekanisme **VOID/Reversal** terpisah dengan alasan wajib dan jejak audit.
4. **Penomoran Batch Atomik:** Format kode batch dikunci sebagai `PFI-BCH-YYYYMMDD-XXX` berdasarkan `entry_date` (tanggal masuk ikan aktual, bukan tanggal input), dengan batas maksimum urutan harian $999$ ($001\text{--}999$).
5. **Stok Terkomputasi (Computed Stock):** Stok tidak disimpan sebagai kolom statis yang dapat diedit manual, melainkan dihitung dari transaksi valid (akan diimplementasikan penuh pada modul fase berikutnya).
6. **Keamanan Berlapis & Idempotency:** Otorisasi menerapkan RBAC 3 _role_ utama, hak akses database dipisah secara granular, dan seluruh mutasi dilindungi oleh _Idempotency-Key_ ($\text{UUIDv4}$) dalam satu siklus transaksi ACID.

---

## 2. Spesifikasi Kebutuhan Sistem (FR & NFR)

### 2.1 Functional Requirements (FR)

- **FR-01 (Pembuatan Batch Otomatis):** Setiap pencatatan penerimaan ikan valid secara otomatis membuat satu _batch_ baru dengan status awal `'active'`.
- **FR-02 (Validasi Input Wajib):**
  - `species_id`: Wajib merujuk pada master spesies yang berstatus aktif (`is_active = true`).
  - `entry_date`: Wajib format ISO `YYYY-MM-DD` dan tidak boleh melebihi tanggal hari ini pada zona waktu **Asia/Jakarta**.
  - `quantity`: Wajib bilangan bulat (_integer_) dengan rentang $1 \le \text{quantity} \le 1.000.000$ ekor.
  - `purchase_capital`: Wajib numerik desimal dengan rentang $\text{Rp } 0,00 \le \text{purchase\_capital} \le \text{Rp } 9.999.999.999,00$ (tanpa nilai _default_).
  - `shipping_capital`: Wajib numerik desimal dengan rentang $\text{Rp } 0,00 \le \text{shipping\_capital} \le \text{Rp } 9.999.999.999,00$ (tanpa nilai _default_; merepresentasikan alokasi ongkos kirim untuk _batch_ tersebut).
  - `fish_size`: Wajib dipilih dari daftar standar baku: `"2-4 cm"`, `"3-5 cm"`, `"4-6 cm"`, `"5-7 cm"`, `"6-8 cm"`, `"7-9 cm"`, `"8-10 cm"`, `"9-11 cm"`, `"10-12 cm"`.
- **FR-03 (Input Sampel Berat Opsional):**
  - `weight_sample_per_500`: Opsional (boleh `NULL` atau tidak dikirim). Jika diisi, satuan baku adalah **gram per 500 ekor** dengan rentang $0,01 \le \text{weight\_sample\_per\_500} \le 100.000,00$ gram.
- **FR-04 (Pembatalan Transaksi / VOID):**
  - Penerimaan yang belum memiliki transaksi turunan (penjualan, kematian, pakan) dapat di-VOID oleh role berwenang dengan menyertakan alasan (`reason`) yang tidak kosong.
  - Penerimaan yang sudah memiliki transaksi turunan otomatis ditolak untuk di-VOID.
- **FR-05 (Konsep Kalkulasi Stok & Penutupan Batch):**
  - Rumus stok aktual:
    $$\text{Stok Batch} = \text{Total Penerimaan Valid} - \text{Total Penjualan Valid} - \text{Total Kematian Valid}$$
  - Transaksi berstatus VOID tidak dihitung dalam kalkulasi stok.
  - Perubahan status _batch_ dari `'active'` menjadi `'completed'` hanya diizinkan apabila sisa stok valid bernilai mutlak $0$ _(implementasi penuh ditunda ke fase modul penjualan & kematian)_.

### 2.2 Non-Functional Requirements (NFR)

- **NFR-01 (Autentikasi & Otorisasi RBAC):** Autentikasi menggunakan JWT terverifikasi; identitas pembuat/pelaku wajib diekstrak dari _claims_ JWT. Otorisasi menerapkan satu _role_ per pengguna untuk MVP.
- **NFR-02 (Validasi 3 Lapis):** Validasi tipe, format, dan batas nilai ditegakkan di _Frontend_ (UX), _Backend_ (Schema/Business Validator), dan _Database_ (CHECK, UNIQUE, FOREIGN KEY, dan TRIGGER).
- **NFR-03 (Atomisitas Transaksi):** Pencatatan _idempotency_, inkrementasi _sequence_, penyisipan `batches`, `incoming_fish`, dan `audit_logs` dieksekusi dalam satu transaksi database (ACID).
- **NFR-04 (Idempotency & Anti-Duplikasi):** Mencegah transaksi ganda akibat gangguan jaringan menggunakan header `Idempotency-Key` ($\text{UUIDv4}$) dengan kebijakan _retry_ Opsi A (kegagalan validasi sebelum transaksi tidak mengunci _key_).
- **NFR-05 (Kinerja / Performance SLA):** Minimal $95\%$ permintaan (_95th percentile_) penyimpanan penerimaan ikan harus memperoleh respons dalam waktu maksimal $1,5\text{ detik}$ pada pengujian beban $50$ _concurrent requests_ di lingkungan _staging_ (spesifikasi minimal $2\text{ vCPU}$, $4\text{ GB RAM}$, dengan populasi database minimal $100.000$ _records_).

### 2.3 Matriks Kewenangan Role (RBAC Scope MVP)

> **Perubahan disetujui Owner (2026-11-17):** role `Owner` kini diizinkan membuat dan melakukan VOID penerimaan. Perubahan ini menggantikan larangan Owner pada matriks sebelumnya; alasan VOID, pemeriksaan transaksi turunan, audit, dan seluruh invariants V4.5 tetap berlaku.

| Hak Akses / Fitur                      |   `Owner`    |        `Admin Operasional`         | `Kepala Budidaya` |
| :------------------------------------- | :----------: | :--------------------------------: | :---------------: |
| **Melihat Data Penerimaan & Batch**    | ✅ Diizinkan |            ✅ Diizinkan            |   ✅ Diizinkan    |
| **Melihat Laporan Audit Log**          | ✅ Diizinkan |            ✅ Diizinkan            |   ✅ Diizinkan    |
| **Membuat Penerimaan Ikan (`POST`)**   | ✅ Diizinkan |            ✅ Diizinkan            |   ✅ Diizinkan    |
| **Melakukan Pembatalan VOID (`POST`)** | ✅ Diizinkan |            ✅ Diizinkan            |    ❌ Ditolak     |
| **Mengelola Master Spesies (API)**     |  ❌ Ditolak  | ❌ _(Via Seeding DB / Out of MVP)_ |    ❌ Ditolak     |

---

## 3. Arsitektur Database & Data Dictionary (PostgreSQL 13+)

### 3.1 Pemisahan Cakupan Modul (MVP vs Roadmap Masa Depan)

- **Cakupan Tabel MVP (Diimplementasikan pada Sprint 1):**
  `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, `audit_logs`.
- **Cakupan Fase Selanjutnya (Out of MVP Scope):**
  `fish_sales` (penjualan), `fish_mortalities` (kematian), `feed_usages` (penggunaan pakan), `operational_expenses` (biaya khusus batch vs biaya umum), `cash_transactions` (arus kas), dan `shipments` (induk pengiriman gabungan opsional).

### 3.2 Granular Database Privileges & Perlindungan Imutabilitas

1. **Migration Role (DDL):** Memiliki privilese penuh (`CREATE`, `ALTER`, `DROP`, `TRIGGER`) untuk menjalankan skrip migrasi dan _seeding_.
2. **App Runtime Role (DML Terbatas):**
   - `incoming_fish`: Hanya `SELECT`, `INSERT`. (`UPDATE` dan `DELETE` dicabut mutlak).
   - `audit_logs`: Hanya `SELECT`, `INSERT`. (`UPDATE` dan `DELETE` dicabut mutlak).
   - `incoming_fish_voids`: Hanya `SELECT`, `INSERT`. (`UPDATE` dan `DELETE` dicabut mutlak).
   - `batch_daily_sequences`: `SELECT` dan `UPDATE` (terbatas pada kolom `last_number`).
   - `batches`: `SELECT` dan `UPDATE` (terbatas pada kolom `status`).
   - `idempotency_keys`: `SELECT`, `INSERT`, dan `UPDATE` (terbatas pada kolom `status`, `response_status`, `response_body`, `completed_at`).
   - `fish_species` & `users`: Hanya `SELECT`.
3. **Database Trigger Protection:** Dipasang _trigger_ `BEFORE UPDATE OR DELETE` pada tabel `incoming_fish` dan `audit_logs` yang melemparkan `EXCEPTION` untuk memblokir modifikasi historis dari jalur mana pun.

### 3.3 Data Dictionary Lengkap

#### 1. Tabel `users`

| Kolom           | Tipe Data                 | Constraint & Aturan                                                                                         |
| :-------------- | :------------------------ | :---------------------------------------------------------------------------------------------------------- |
| `id`            | `UUID`                    | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                                     |
| `name`          | `VARCHAR(255)`            | `NOT NULL`                                                                                                  |
| `email`         | `CITEXT` / `VARCHAR(255)` | `NOT NULL`, unik _case-insensitive_ via `CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email))` |
| `password_hash` | `VARCHAR(255)`            | `NOT NULL`                                                                                                  |
| `role`          | `VARCHAR(50)`             | `NOT NULL`, `CHECK (role IN ('Owner', 'Admin Operasional', 'Kepala Budidaya'))`                             |
| `is_active`     | `BOOLEAN`                 | `NOT NULL DEFAULT true`                                                                                     |
| `created_at`    | `TIMESTAMPTZ`             | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                                                                        |

#### 2. Tabel `fish_species`

| Kolom          | Tipe Data      | Constraint & Aturan                     |
| :------------- | :------------- | :-------------------------------------- |
| `id`           | `UUID`         | `PRIMARY KEY DEFAULT gen_random_uuid()` |
| `species_code` | `VARCHAR(50)`  | `NOT NULL UNIQUE`                       |
| `species_name` | `VARCHAR(100)` | `NOT NULL`                              |
| `is_active`    | `BOOLEAN`      | `NOT NULL DEFAULT true`                 |
| `created_at`   | `TIMESTAMPTZ`  | `NOT NULL DEFAULT CURRENT_TIMESTAMP`    |

**Data Seeding Awal Master Spesies (Migration Seed):**

- `LELE` — Lele
- `PATIN` — Patin
- `GURAME-MERAH` — Gurame Merah
- `GURAME-HITAM` — Gurame Hitam
- `NILA-HITAM` — Nila Hitam
- `NILA-MERAH` — Nila Merah

#### 3. Tabel `batch_daily_sequences`

| Kolom         | Tipe Data | Constraint & Aturan                                         |
| :------------ | :-------- | :---------------------------------------------------------- |
| `entry_date`  | `DATE`    | `PRIMARY KEY` (Berdasarkan tanggal penerimaan `entry_date`) |
| `last_number` | `INTEGER` | `NOT NULL`, `CHECK (last_number BETWEEN 0 AND 999)`         |

#### 4. Tabel `batches`

| Kolom        | Tipe Data     | Constraint & Aturan                                               |
| :----------- | :------------ | :---------------------------------------------------------------- |
| `id`         | `UUID`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                           |
| `batch_code` | `VARCHAR(50)` | `NOT NULL UNIQUE` (Format: `PFI-BCH-YYYYMMDD-XXX`)                |
| `species_id` | `UUID`        | `NOT NULL`, `REFERENCES fish_species(id) ON DELETE RESTRICT`      |
| `status`     | `VARCHAR(20)` | `NOT NULL`, `CHECK (status IN ('active', 'completed', 'voided'))` |
| `created_by` | `UUID`        | `NOT NULL`, `REFERENCES users(id) ON DELETE RESTRICT`             |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                              |

#### 5. Tabel `incoming_fish` (Append-Only / Immutable)

| Kolom                   | Tipe Data       | Constraint & Aturan                                                                                                               |
| :---------------------- | :-------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `UUID`          | `PRIMARY KEY DEFAULT gen_random_uuid()`                                                                                           |
| `batch_id`              | `UUID`          | `NOT NULL UNIQUE`, `REFERENCES batches(id) ON DELETE RESTRICT`                                                                    |
| `entry_date`            | `DATE`          | `NOT NULL`                                                                                                                        |
| `quantity`              | `INTEGER`       | `NOT NULL`, `CHECK (quantity BETWEEN 1 AND 1000000)`                                                                              |
| `purchase_capital`      | `NUMERIC(18,2)` | `NOT NULL` _(tanpa default)_, `CHECK (purchase_capital BETWEEN 0 AND 9999999999.00)`                                              |
| `shipping_capital`      | `NUMERIC(18,2)` | `NOT NULL` _(tanpa default)_, `CHECK (shipping_capital BETWEEN 0 AND 9999999999.00)`                                              |
| `weight_sample_per_500` | `NUMERIC(12,2)` | `NULLABLE`, `CHECK (weight_sample_per_500 IS NULL OR weight_sample_per_500 BETWEEN 0.01 AND 100000.00)`                           |
| `fish_size`             | `VARCHAR(20)`   | `NOT NULL`, `CHECK (fish_size IN ('2-4 cm', '3-5 cm', '4-6 cm', '5-7 cm', '6-8 cm', '7-9 cm', '8-10 cm', '9-11 cm', '10-12 cm'))` |
| `created_by`            | `UUID`          | `NOT NULL`, `REFERENCES users(id) ON DELETE RESTRICT`                                                                             |
| `created_at`            | `TIMESTAMPTZ`   | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                                                                                              |

#### 6. Tabel `incoming_fish_voids` (Append-Only / Immutable)

| Kolom              | Tipe Data     | Constraint & Aturan                                                  |
| :----------------- | :------------ | :------------------------------------------------------------------- |
| `id`               | `UUID`        | `PRIMARY KEY DEFAULT gen_random_uuid()`                              |
| `incoming_fish_id` | `UUID`        | `NOT NULL UNIQUE`, `REFERENCES incoming_fish(id) ON DELETE RESTRICT` |
| `reason`           | `TEXT`        | `NOT NULL`, `CHECK (reason <> '' AND TRIM(reason) <> '')`            |
| `voided_by`        | `UUID`        | `NOT NULL`, `REFERENCES users(id) ON DELETE RESTRICT`                |
| `voided_at`        | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                                 |

#### 7. Tabel `idempotency_keys`

| Kolom             | Tipe Data      | Constraint & Aturan                                                       |
| :---------------- | :------------- | :------------------------------------------------------------------------ |
| `id`              | `UUID`         | `PRIMARY KEY DEFAULT gen_random_uuid()`                                   |
| `user_id`         | `UUID`         | `NOT NULL`, `REFERENCES users(id) ON DELETE RESTRICT`                     |
| `endpoint`        | `VARCHAR(255)` | `NOT NULL`                                                                |
| `idempotency_key` | `UUID`         | `NOT NULL`                                                                |
| `payload_hash`    | `VARCHAR(64)`  | `NOT NULL` (SHA-256 dari payload bisnis ternormalisasi)                   |
| `status`          | `VARCHAR(20)`  | `NOT NULL`, `CHECK (status IN ('processing', 'completed'))`               |
| `response_status` | `INTEGER`      | `NULLABLE` (Menyimpan HTTP status asli, misal `201` atau `200`)           |
| `response_body`   | `JSONB`        | `NULLABLE` (Hanya menyimpan respons kanonis: `status`, `message`, `data`) |
| `created_at`      | `TIMESTAMPTZ`  | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                                      |
| `completed_at`    | `TIMESTAMPTZ`  | `NULLABLE`                                                                |

_Index Unik Gabungan:_ `CREATE UNIQUE INDEX idx_idempotency_user_endpoint_key ON idempotency_keys (user_id, endpoint, idempotency_key);`

#### 8. Tabel `audit_logs` (Append-Only / Immutable)

| Kolom         | Tipe Data      | Constraint & Aturan                                            |
| :------------ | :------------- | :------------------------------------------------------------- |
| `id`          | `UUID`         | `PRIMARY KEY DEFAULT gen_random_uuid()`                        |
| `request_id`  | `VARCHAR(255)` | `NOT NULL`                                                     |
| `actor_id`    | `UUID`         | `NOT NULL`, `REFERENCES users(id) ON DELETE RESTRICT`          |
| `action`      | `VARCHAR(50)`  | `NOT NULL`, `CHECK (action IN ('CREATE_ENTRY', 'VOID_ENTRY'))` |
| `entity_type` | `VARCHAR(50)`  | `NOT NULL`                                                     |
| `entity_id`   | `UUID`         | `NOT NULL`                                                     |
| `old_values`  | `JSONB`        | `NULLABLE`                                                     |
| `new_values`  | `JSONB`        | `NULLABLE`                                                     |
| `reason`      | `TEXT`         | `NULLABLE`                                                     |
| `ip_address`  | `VARCHAR(45)`  | `NULLABLE`                                                     |
| `created_at`  | `TIMESTAMPTZ`  | `NOT NULL DEFAULT CURRENT_TIMESTAMP`                           |

---

## 4. Prosedur Transaksi Atomik & Concurrency Control

### 4.1 Inisialisasi & Increment Sequence Harian Atomik

```sql
-- 1. Inisialisasi baris tanggal jika belum tersedia
INSERT INTO batch_daily_sequences (entry_date, last_number)
VALUES (:entry_date, 0)
ON CONFLICT (entry_date) DO NOTHING;

-- 2. Increment atomik dengan batas pengaman < 999
UPDATE batch_daily_sequences
SET last_number = last_number + 1
WHERE entry_date = :entry_date AND last_number < 999
RETURNING last_number;
```

- **Aturan Penanganan:** Jika perintah `UPDATE` mengembalikan _row count_ $0$, transaksi di-_rollback_ dan backend mengembalikan **HTTP 422 Unprocessable Content** (`BATCH_SEQUENCE_EXHAUSTED`). Nomor urut bersifat global per tanggal untuk seluruh spesies dan tidak boleh didaur ulang meskipun _batch_ di-VOID.

### 4.2 Deferred Constraint Trigger (Jaminan Relasi $1:1$)

- Dipasang pada tabel `batches` untuk _event_ `INSERT` dengan konfigurasi `CONSTRAINT TRIGGER ... INITIALLY DEFERRED`.
- Dievaluasi tepat pada saat transaksi mencapai instruksi `COMMIT`:

```sql
IF NOT EXISTS (SELECT 1 FROM incoming_fish WHERE batch_id = NEW.id) THEN
    RAISE EXCEPTION 'Constraint Violation: Batch % must have exactly one incoming_fish record.', NEW.id;
END IF;
```

### 4.3 Algoritma Normalisasi Payload Hash (SHA-256)

1. Validasi format dasar dan pastikan seluruh nilai desimal bernilai $\ge 0$.
2. Hapus seluruh properti yang bernilai `null` secara rekursif (properti bernilai `null` dan properti yang tidak dikirimkan dianggap identik).
3. Urutkan seluruh _keys_ objek secara alfabetis ($\text{A--Z}$) secara rekursif.
4. Pertahankan urutan elemen di dalam _array_ sesuai payload aslinya.
5. **Normalisasi Field Desimal Khusus:** Pemangkasan _trailing zeros_ hanya berlaku pada 3 parameter desimal: `purchase_capital`, `shipping_capital`, dan `weight_sample_per_500` (misal: `"2500000.00"` $\rightarrow$ `"2500000"`, `"485.50"` $\rightarrow$ `"485.5"`). Field string non-desimal lainnya (`fish_size`, `entry_date`, UUID) tidak diubah.
6. Hitung SHA-256 murni dari payload bisnis yang telah dinormalisasi (tidak mencakup header, JWT, atau `request_id`).

### 4.4 Alur 10 Langkah Transaksi Penerimaan Ikan

1. **Authentication & RBAC Check:** Verifikasi JWT, pastikan akun aktif, dan periksa _role_ (`Admin Operasional` atau `Kepala Budidaya`).
2. **Payload & Timezone Validation:** Validasi skema JSON, batas numerik, enum ukuran, serta pastikan `entry_date` $\le$ tanggal hari ini pada zona waktu **Asia/Jakarta**. _(Kegagalan di langkah 1--2 mengembalikan HTTP 400/401/403/422 tanpa menulis ke database, sehingga `Idempotency-Key` boleh dipakai ulang)._
3. **Normalisasi & Hashing:** Hitung `payload_hash` SHA-256.
4. **Begin DB Transaction & Idempotency Lock:** Eksekusi `INSERT INTO idempotency_keys` dengan status `'processing'`. Jika terjadi konflik _unique constraint_ `(user_id, endpoint, idempotency_key)`:
   - Tunggu transaksi pertama selesai melepas _lock_.
   - Baca ulang record: jika transaksi pertama `COMMIT` (`status = 'completed'`) dan `payload_hash` sama, kembalikan respons _cached_; jika `payload_hash` berbeda, kembalikan **HTTP 409 Conflict** (`IDEMPOTENCY_MISMATCH`).
   - Jika transaksi pertama `ROLLBACK`, ambil alih pemrosesan dengan kunci yang sama.
5. **Master Species Check:** Pastikan `species_id` eksis di `fish_species` dan berstatus `is_active = true` (jika tidak, _rollback_ dan kembalikan **HTTP 422** `SPECIES_NOT_ACTIVE`).
6. **Sequence Allocation:** Jalankan inisialisasi dan _update_ atomik `batch_daily_sequences` ($< 999$), lalu bentuk `batch_code` (`PFI-BCH-YYYYMMDD-XXX`).
7. **Insert Master & Detail:** Simpan baris baru ke `batches` dan `incoming_fish` dengan `created_by` dari JWT.
8. **Write Audit Log:** Simpan rekam jejak ke `audit_logs` (`action = 'CREATE_ENTRY'`) dalam transaksi yang sama.
9. **Finalize Idempotency:** Perbarui `idempotency_keys` menjadi `status = 'completed'`, simpan `response_status`, `response_body` (hanya `status`, `message`, `data`), dan `completed_at`.
10. **Commit & Return Response:** _Commit_ transaksi database (memicu validasi _Deferred Constraint Trigger_) dan kembalikan respons lengkap dengan blok `meta` dinamis.

### 4.5 Alur 8 Langkah Atomic VOID & Master Locking

1. **Authentication & RBAC Check:** Verifikasi JWT dan pastikan _role_ pengguna adalah `Admin Operasional`.
2. **Begin DB Transaction & Idempotency Lock:** Jalankan mekanisme `idempotency_keys` untuk endpoint VOID.
3. **Master Row Locking:** Eksekusi `SELECT * FROM batches WHERE id = :batch_id FOR UPDATE;`. Jika tidak ditemukan, kembalikan **HTTP 404** (`BATCH_NOT_FOUND`).
4. **Status Verification:** Pastikan `status == 'active'`. Jika tidak (`'voided'` atau `'completed'`), kembalikan **HTTP 409** (`BATCH_NOT_ACTIVE`).
5. **Dependent Transaction Check:** Periksa keberadaan transaksi turunan pada modul terkait (ketika tabel fase berikutnya sudah tersedia). Jika ditemukan, _rollback_ dan kembalikan **HTTP 409** (`HAS_DEPENDENT_TRANSACTIONS`).
6. **Insert VOID Record:** Simpan ke `incoming_fish_voids` (`incoming_fish_id`, `reason`, `voided_by`). Data pada `incoming_fish` tidak diubah maupun dihapus.
7. **Update Batch & Audit Log:** Perbarui `batches.status = 'voided'`, lalu simpan ke `audit_logs` (`action = 'VOID_ENTRY'`).
8. **Finalize Idempotency & Commit:** Perbarui `idempotency_keys` menjadi `'completed'`, lalu `COMMIT` transaksi.

_(Catatan Master Locking: Seluruh endpoint pembuatan transaksi turunan di fase mendatang wajib mengunci baris `batches` menggunakan `SELECT ... FOR UPDATE` dan memverifikasi `status = 'active'` sebelum melakukan `INSERT`)._

---

## 5. API Contracts

### 5.1 Endpoint 1: Pencatatan Penerimaan Ikan Masuk

- **Method & Endpoint:** `POST /api/v1/fish-entries`
- **Headers Wajib:**
  - `Authorization: Bearer <jwt_token>`
  - `Idempotency-Key: <UUIDv4>`
  - `Content-Type: application/json`

**Request Body:**

```json
{
  "species_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "entry_date": "2026-11-12",
  "quantity": 5000,
  "purchase_capital": "2500000.00",
  "shipping_capital": "150000.00",
  "weight_sample_per_500": "485.50",
  "fish_size": "3-5 cm"
}
```

**Response Sukses (`201 Created`):**
_(Nilai moneter dan desimal berat dikembalikan sebagai String desimal agar konsisten dengan request)._

```json
{
  "status": "success",
  "message": "Penerimaan ikan berhasil dicatat dan Batch telah dibuat.",
  "data": {
    "batch": {
      "id": "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1",
      "batch_code": "PFI-BCH-20261112-001",
      "status": "active"
    },
    "incoming_fish": {
      "id": "c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2",
      "entry_date": "2026-11-12",
      "quantity": 5000,
      "purchase_capital": "2500000.00",
      "shipping_capital": "150000.00",
      "weight_sample_per_500": "485.50",
      "fish_size": "3-5 cm"
    }
  },
  "meta": {
    "idempotency_status": "executed",
    "request_id": "req-7a8b9c-20261112"
  }
}
```

_(Pada retry jaringan dengan key dan payload identik, `status`, `message`, dan `data` diambil dari cache database, sementara `meta` direkonstruksi dengan `"idempotency_status": "cached"` dan `request_id` baru)._

---

### 5.2 Endpoint 2: Pembatalan Penerimaan Ikan (VOID)

- **Method & Endpoint:** `POST /api/v1/fish-entries/{batch_id}/void`
- **Akses RBAC:** Khusus `Admin Operasional`
- **Headers Wajib:**
  - `Authorization: Bearer <jwt_token>`
  - `Idempotency-Key: <UUIDv4>`
  - `Content-Type: application/json`

**Request Body:**

```json
{
  "reason": "Kesalahan input ukuran ikan dari supplier pada saat penimbangan."
}
```

**Response Sukses (`200 OK`):**

```json
{
  "status": "success",
  "message": "Transaksi penerimaan ikan berhasil di-VOID.",
  "data": {
    "batch_id": "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1",
    "batch_code": "PFI-BCH-20261112-001",
    "status": "voided"
  },
  "meta": {
    "idempotency_status": "executed",
    "request_id": "req-void-99412"
  }
}
```

---

### 5.3 Pemetaan Error Code Terstandarisasi

| HTTP Code | Error Code                   | Penyebab & Penanganan                                                                                    |
| :-------: | :--------------------------- | :------------------------------------------------------------------------------------------------------- |
| **`400`** | `INVALID_PAYLOAD`            | JSON tidak valid, field wajib hilang, batas kuantitas/modal/berat terlampaui, atau `reason` VOID kosong. |
| **`400`** | `INVALID_IDEMPOTENCY_KEY`    | Header `Idempotency-Key` tidak dikirim atau formatnya bukan $\text{UUIDv4}$ yang valid.                  |
| **`401`** | `UNAUTHORIZED`               | Token JWT hilang, kedaluwarsa, atau tanda tangan tidak sah.                                              |
| **`403`** | `FORBIDDEN`                  | Role pengguna tidak memiliki otorisasi pada endpoint terkait.                                            |
| **`404`** | `BATCH_NOT_FOUND`            | Parameter `{batch_id}` pada URL VOID tidak ditemukan di database.                                        |
| **`409`** | `IDEMPOTENCY_MISMATCH`       | `Idempotency-Key` sama telah digunakan untuk payload bisnis yang berbeda.                                |
| **`409`** | `BATCH_NOT_ACTIVE`           | Upaya VOID terhadap _batch_ yang sudah berstatus `'voided'` atau `'completed'`.                          |
| **`409`** | `HAS_DEPENDENT_TRANSACTIONS` | Upaya VOID terhadap _batch_ yang sudah memiliki transaksi turunan.                                       |
| **`422`** | `SPECIES_NOT_ACTIVE`         | `species_id` merujuk pada spesies dengan `is_active = false`.                                            |
| **`422`** | `INVALID_ENTRY_DATE`         | `entry_date` melebihi tanggal hari ini pada zona waktu Asia/Jakarta.                                     |
| **`422`** | `BATCH_SEQUENCE_EXHAUSTED`   | Kapasitas kode _batch_ harian telah mencapai batas maksimum ($999$).                                     |
| **`429`** | `RATE_LIMIT_EXCEEDED`        | Frekuensi permintaan melebihi ambang batas _rate limiter_.                                               |
| **`500`** | `INTERNAL_SERVER_ERROR`      | Kesalahan sistem internal yang tidak terduga.                                                            |
| **`503`** | `DATABASE_LOCK_TIMEOUT`      | Antrean penguncian baris database melampaui batas waktu tunggu (_timeout_).                              |
| **`503`** | `DATABASE_UNAVAILABLE`       | Koneksi ke database terputus atau layanan database tidak tersedia.                                       |

---

## 6. Skenario Pengujian QA Mutlak (32 Test Cases) & Definition of Done

### 6.1 Daftar 32 Test Cases Wajib

|    ID     | Kategori                 | Skenario Pengujian                                                                                              | Ekspektasi Hasil                                                                                                         |
| :-------: | :----------------------- | :-------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **TC-01** | Positive Test            | Input penerimaan ikan lengkap dan valid.                                                                        | HTTP `201 Created`; `batches`, `incoming_fish`, dan `audit_logs` tersimpan atomik.                                       |
| **TC-02** | Negative Validation      | `quantity = 0`, modal negatif, atau `fish_size` di luar enum.                                                   | HTTP `400 Bad Request` (`INVALID_PAYLOAD`); tidak ada record tersimpan.                                                  |
| **TC-03** | Boundary Qty             | Uji `quantity` bernilai $1$, $1.000.000$, dan $1.000.001$.                                                      | $1$ & $1.000.000$ sukses (`201`); $1.000.001$ ditolak (`400`).                                                           |
| **TC-04** | Authentication           | Request tanpa header `Authorization` atau token JWT kedaluwarsa.                                                | HTTP `401 Unauthorized`.                                                                                                 |
| **TC-05** | Authorization            | `Owner`, `Admin Operasional`, dan `Kepala Budidaya` akses `POST /fish-entries`; Owner/Admin akses `POST /void`. | Owner/Admin/Kepala Budidaya sukses input (`201`); Owner/Admin sukses VOID (`200`); Kepala Budidaya ditolak VOID (`403`). |
| **TC-06** | Idempotency Retry        | Kirim ulang request identik dengan `Idempotency-Key` yang sama.                                                 | HTTP `201 Created` dengan `"idempotency_status": "cached"` dan `request_id` baru.                                        |
| **TC-07** | Concurrency Sequence     | $50$ request bersamaan dengan key unik pada tanggal yang sama.                                                  | Terbentuk $50$ _batch_ dengan kode berurutan (`001`--`050`) tanpa duplikasi atau _deadlock_.                             |
| **TC-08** | Atomicity Rollback       | Simulasi kegagalan _insert_ pada lapisan persistensi (_fault injection_).                                       | Transaksi `ROLLBACK` total; tidak ada `batches`, `incoming_fish`, maupun `idempotency_keys` tersisa.                     |
| **TC-09** | Data Integrity           | Verifikasi kardinalitas relasi antara `batches` dan `incoming_fish`.                                            | Setiap _batch_ terhubung tepat ke satu transaksi penerimaan ($1:1$).                                                     |
| **TC-10** | Regression               | Pengujian regresi otomatis seluruh alur utama pasca-pembaruan kode.                                             | Seluruh aturan bisnis V4.5 tetap terpenuhi tanpa efek samping.                                                           |
| **TC-11** | Inactive Species         | Input menggunakan `species_id` berstatus `is_active = false`.                                                   | HTTP `422 Unprocessable Content` (`SPECIES_NOT_ACTIVE`).                                                                 |
| **TC-12** | Sequence Init            | $2$ request bersamaan tepat saat tanggal baru pertama kali digunakan (`last_number = 0`).                       | Inisialisasi `ON CONFLICT DO NOTHING` berjalan mulus tanpa error duplikasi PK.                                           |
| **TC-13** | Audit Log Failure        | Trigger kegagalan penyimpanan khusus pada tabel `audit_logs`.                                                   | Seluruh transaksi penerimaan dan pembuatan _batch_ ikut di-_rollback_.                                                   |
| **TC-14** | Hash Normalization       | Payload dengan `"weight_sample_per_500": null` vs key dihilangkan; `"2500000.00"` vs `"2500000"`.               | Menghasilkan hash SHA-256 identik dan dikenali sebagai retry valid (`cached`).                                           |
| **TC-15** | Cross-User Idempotency   | User A dan User B menggunakan `Idempotency-Key` UUID yang sama secara kebetulan.                                | Kedua transaksi diproses terpisah berkat index unik `(user_id, endpoint, idempotency_key)`.                              |
| **TC-16** | Case-Insensitive Email   | Pendaftaran/pencarian email `User@PFI.com` vs `user@pfi.com`.                                                   | Dikenali sebagai identitas tunggal dan dicegah duplikasinya oleh index `LOWER(email)`.                                   |
| **TC-17** | Deferred Trigger         | _Direct SQL_ `INSERT` ke `batches` tanpa menyisipkan `incoming_fish`.                                           | Ditolak paksa saat eksekusi `COMMIT` oleh _Deferred Constraint Trigger_.                                                 |
| **TC-18** | Lock Timeout             | Simulasi antrean _database lock_ melebihi batas waktu tunggu.                                                   | HTTP `503 Service Unavailable` (`DATABASE_LOCK_TIMEOUT`).                                                                |
| **TC-19** | Future Date              | Pengisian `entry_date` dengan tanggal besok menurut zona waktu Asia/Jakarta.                                    | HTTP `422 Unprocessable Content` (`INVALID_ENTRY_DATE`).                                                                 |
| **TC-20** | VOID Dependency          | Pengajuan VOID pada _batch_ yang sudah memiliki transaksi turunan.                                              | HTTP `409 Conflict` (`HAS_DEPENDENT_TRANSACTIONS`).                                                                      |
| **TC-21** | Data Immutability        | Percobaan SQL `UPDATE` atau `DELETE` pada tabel `incoming_fish` dan `audit_logs`.                               | Ditolak mutlak oleh _DB Runtime Privileges_ dan _Trigger Exception_.                                                     |
| **TC-22** | Status Guard             | Percobaan mutasi status _batch_ ilegal atau `completed` saat stok $> 0$.                                        | Ditolak oleh _CHECK Constraint_ / _Status Guard_.                                                                        |
| **TC-23** | Boundary Weight Min      | Input `weight_sample_per_500 = "0.01"`.                                                                         | HTTP `201 Created` (Diterima).                                                                                           |
| **TC-24** | Boundary Weight Max      | Input `weight_sample_per_500 = "100000.00"`.                                                                    | HTTP `201 Created` (Diterima).                                                                                           |
| **TC-25** | Boundary Weight Invalid  | Input `weight_sample_per_500 = "100000.01"`.                                                                    | HTTP `400 Bad Request` (`INVALID_PAYLOAD`).                                                                              |
| **TC-26** | Boundary Capital Max     | Input `purchase_capital = "9999999999.00"` dan `shipping_capital = "9999999999.00"`.                            | HTTP `201 Created` (Diterima).                                                                                           |
| **TC-27** | Boundary Capital Invalid | Input `purchase_capital = "10000000000.00"`.                                                                    | HTTP `400 Bad Request` (`INVALID_PAYLOAD`).                                                                              |
| **TC-28** | Master Lock Concurrency  | Eksekusi bersamaan antara VOID dan penyisipan transaksi turunan pada _batch_ sama.                              | `SELECT ... FOR UPDATE` menserialisasi proses tanpa inkonsistensi status/stok.                                           |
| **TC-29** | VOID Retry Concurrency   | $2$ request VOID dikirim serentak dengan `Idempotency-Key` dan `reason` yang sama.                              | Request pertama sukses (`200 OK`); request kedua mengembalikan respons `cached`.                                         |
| **TC-30** | Sequence Exhausted       | Permintaan penerimaan baru saat `last_number` pada tanggal terkait sudah $999$.                                 | Query `UPDATE` mengembalikan $0$ baris $\rightarrow$ HTTP `422` (`BATCH_SEQUENCE_EXHAUSTED`).                            |
| **TC-31** | Header Validation        | Request tanpa header `Idempotency-Key` atau dengan format bukan UUIDv4.                                         | HTTP `400 Bad Request` (`INVALID_IDEMPOTENCY_KEY`).                                                                      |
| **TC-32** | VOID Key Conflict        | $2$ request VOID menggunakan `Idempotency-Key` berbeda untuk `batch_id` yang sama.                              | Request pertama sukses (`200 OK`); request kedua ditolak HTTP `409 Conflict` (`BATCH_NOT_ACTIVE`).                       |

### 6.2 Definition of Done (DoD) & Urutan Eksekusi Sprint 1

Implementasi Sprint 1 dinyatakan selesai apabila memenuhi seluruh standar berikut:

1. **Database Migration & Seeding:** Skrip migrasi tabel, _granular privileges_, _triggers_, dan _seeding_ master spesies berhasil dijalankan dan diuji _rollback_-nya pada database PostgreSQL 13+ bersih.
2. **Backend Implementation:** Seluruh logika validasi zona waktu Asia/Jakarta, normalisasi SHA-256, transaksi atomik, dan endpoint `POST /api/v1/fish-entries` serta `POST /api/v1/fish-entries/{batch_id}/void` selesai dibangun.
3. **Automated & Integration Testing:** Seluruh $32$ Test Cases (**TC-01** hingga **TC-32**) lulus $100\%$.
4. **Performance Benchmark:** Pengujian beban memenuhi target NFR-05 ($\le 1,5\text{ detik}$ pada _95th percentile_ untuk $50$ _concurrent requests_).
5. **Frontend Integration & QA Sign-Off:** Form input (dengan _input masking_ Rupiah dan pembangkitan $\text{UUIDv4}$ saat _submit_) terintegrasi penuh dan lulus verifikasi _staging_.

---

# BAGIAN II — PERLUASAN MVP IKAN KELUAR (KASIR/POS)

# PERLUASAN MVP --- IKAN KELUAR (KASIR/POS)

## 7. Status, ruang lingkup, dan prinsip perluasan POS

### 7.1 Tujuan modul

Modul Ikan Keluar (Kasir/POS) digunakan untuk mencatat penjualan ikan
berdasarkan batch yang tersedia, menerima pembayaran lunas, mengurangi
stok melalui transaksi penjualan yang valid, membatalkan transaksi
melalui VOID, dan mencetak struk thermal.

Modul ini merupakan tambahan MVP terhadap V4.5. Ia tidak menggantikan
atau mengubah aturan penerimaan ikan yang sudah dikunci.

### 7.2 Ruang lingkup POS

Termasuk dalam rancangan MVP:

- Daftar harga jual berdasarkan kombinasi spesies ikan dan ukuran ikan.
- Pengelolaan harga oleh Owner dan Admin Operasional.
- Pemilihan satu batch untuk satu transaksi/struk.
- Penjualan menggunakan satuan ekor saja.
- Penjualan sebagian dari stok batch.
- Pembayaran lunas melalui Tunai atau Transfer.
- Perhitungan total, uang diterima, dan kembalian untuk pembayaran tunai.
- Penyimpanan transaksi penjualan dan snapshot harga.
- VOID satu transaksi penjualan secara utuh.
- Pengembalian stok melalui VOID penjualan.
- Pencetakan otomatis setelah transaksi berhasil dan pencetakan ulang.
- Dukungan tata letak struk untuk kertas thermal 58 mm maupun 80 mm.

Tidak termasuk dalam rancangan ini:

- Penjualan berdasarkan kilogram atau satuan selain ekor.
- Satu struk berisi beberapa batch.
- Data pelanggan atau CRM.
- Pembayaran cicilan/utang/piutang atau pembayaran sebagian.
- Nomor referensi transfer.
- Diskon, pajak, atau promosi.
- Penghapusan transaksi penjualan.
- Pencetakan bukti khusus untuk transaksi yang sudah di-VOID.
- Integrasi akuntansi atau arus kas otomatis.
- Pemilihan model printer, protokol, library, atau teknologi koneksi tertentu sebelum perangkat aktual ditentukan dan diuji.

## 8. Keputusan bisnis POS yang telah ditetapkan

### 8.1 Produk dan satuan penjualan

1.  Satuan penjualan hanya **ekor**.
2.  Satu transaksi penjualan hanya boleh menggunakan **satu batch**.
3.  Setiap batch hanya memiliki satu spesies dan satu ukuran sesuai
    aturan homogenitas batch V4.5.
4.  Penjualan sebagian dari stok batch diperbolehkan.
5.  Batch yang ditampilkan di POS hanya batch berstatus `active` dan
    memiliki stok tersedia lebih dari 0.
6.  Jika jumlah yang dimasukkan melebihi stok, sistem membatasi nilai ke
    stok tersedia dan meminta konfirmasi kasir sebelum transaksi dapat
    dilanjutkan.
7.  Jika kasir tidak menyetujui jumlah yang telah dibatasi, transaksi
    tidak disimpan.
8.  Jika stok batch mencapai 0 setelah penjualan valid, status batch
    berubah otomatis menjadi `completed`.

### 8.2 Daftar harga

1.  Harga ditetapkan berdasarkan kombinasi:
    - `species_id`
    - `fish_size`
2.  Satu kombinasi spesies dan ukuran memiliki satu harga jual aktif
    pada daftar harga.
3.  Harga jual menggunakan bilangan bulat Rupiah tanpa angka desimal.
4.  Owner dan Admin Operasional berwenang menambah harga baru dan
    mengubah harga yang sudah ada.
5.  Kasir tidak berwenang mengelola harga.
6.  Jika harga untuk kombinasi spesies dan ukuran belum tersedia, batch
    tidak dapat dijual sampai Owner atau Admin Operasional memasukkan
    harga.
7.  Sistem tidak menyimpan riwayat perubahan harga katalog. Harga
    katalog yang lama dapat ditimpa oleh harga baru.
8.  Meskipun katalog harga dapat ditimpa, setiap transaksi penjualan
    wajib menyimpan snapshot `unit_price` dan `total_amount` pada saat
    transaksi dibuat. Perubahan harga katalog setelah transaksi tidak
    boleh mengubah transaksi lama.
9.  Saat kasir akan menyimpan transaksi, harga harus diperbarui dan
    dikonfirmasi terlebih dahulu. Jika harga berubah sejak batch dipilih
    atau sejak harga terakhir ditampilkan, sistem harus menampilkan
    harga terbaru dan meminta konfirmasi ulang sebelum penyimpanan.

### 8.3 Pembayaran

1.  Setiap transaksi wajib dibayar lunas.
2.  Metode pembayaran yang tersedia:
    - `cash` / Tunai
    - `transfer` / Transfer
3.  Pembayaran transfer cukup dengan memilih Transfer dan mengonfirmasi
    bahwa pembayaran telah diterima. Nomor referensi transfer tidak
    diwajibkan.
4.  Untuk pembayaran tunai, kasir memasukkan jumlah uang yang diterima.
5.  Uang diterima boleh lebih besar daripada total transaksi.
6.  Sistem menghitung kembalian secara otomatis.
7.  Uang diterima tidak boleh kurang dari total pembayaran.
8.  Tidak ada status pembayaran sebagian atau belum lunas pada cakupan
    POS ini.

### 8.4 Hak akses POS

Role yang dapat mengakses Kasir/POS:

- `Owner`
- `Admin Operasional`
- `Kasir`

Role `Kasir` merupakan role baru dan harus ditambahkan ke daftar role
yang valid pada sistem. Prinsip satu role per pengguna pada MVP V4.5
tetap dipertahankan.

Matriks kewenangan POS:

---

Hak akses POS Owner Admin Kasir Kepala Budidaya
Operasional

---

Mengakses Ya Ya Ya Tidak
halaman  
 Kasir/POS

Melihat seluruh Ya Ya Ya Tidak
transaksi  
 penjualan

Membuat Ya Ya Ya Tidak
transaksi  
 penjualan

Melakukan VOID Ya Ya Ya Tidak
penjualan

Mengelola Ya Ya Tidak Tidak
daftar harga  
 (tambah/ubah)

Cetak ulang Ya Ya Ya Tidak
transaksi yang  
 dibuat sendiri

Cetak ulang Tidak Tidak Tidak Tidak
transaksi yang  
 dibuat pengguna  
 lain

---

Ketentuan cetak ulang berlaku berdasarkan identitas pembuat transaksi
(`created_by`), bukan semata-mata nama role. Dengan demikian, Owner atau
Admin Operasional hanya dapat mencetak ulang transaksi yang dibuat oleh
akun mereka sendiri.

### 8.5 VOID penjualan

1.  VOID dilakukan terhadap satu transaksi/struk secara utuh. Tidak
    tersedia VOID sebagian item atau sebagian jumlah.
2.  Semua role yang memiliki akses POS (`Owner`, `Admin Operasional`,
    dan `Kasir`) boleh melakukan VOID.
3.  Alasan VOID penjualan tidak wajib diisi.
4.  Satu transaksi hanya dapat di-VOID satu kali.
5.  VOID dapat dilakukan tanpa batas waktu selama transaksi belum pernah
    di-VOID.
6.  Transaksi yang di-VOID tidak dihapus atau ditimpa. Catatan VOID
    disimpan terpisah dan bersifat append-only.
7.  Penjualan yang di-VOID tidak dihitung sebagai pengurang stok.
8.  VOID mengembalikan jumlah ikan yang dijual oleh transaksi tersebut
    ke stok batch.
9.  Jika batch sebelumnya berstatus `completed` dan setelah VOID stok
    valid kembali lebih dari 0, status batch dikembalikan menjadi
    `active`.
10. Jika setelah perhitungan ulang stok tetap 0, status batch tetap
    `completed`.
11. Batch berstatus `voided` tidak boleh diaktifkan kembali melalui VOID
    penjualan.
12. Struk transaksi yang telah di-VOID tidak dapat dicetak ulang melalui
    fungsi cetak ulang POS.
13. Aturan ini khusus untuk VOID penjualan. Aturan VOID penerimaan pada
    V4.5 tetap berlaku tanpa perubahan, termasuk alasan wajib dan
    larangan VOID penerimaan yang sudah memiliki transaksi turunan.

### 8.6 Nomor transaksi

1.  Format nomor transaksi: `PFI-SAL-YYYYMMDD-XXX`.
2.  Tanggal menggunakan zona waktu bisnis `Asia/Jakarta`.
3.  Penomoran berurutan per tanggal dan berlaku global untuk seluruh
    transaksi POS.
4.  Tidak ada batas maksimum 999 transaksi per hari.
5.  Interpretasi format: bagian urutan memiliki minimal tiga digit dan
    boleh bertambah panjang setelah 999 (contoh `001`, `999`, `1000`,
    `1001`). Angka urutan tidak boleh dipotong menjadi tiga digit karena
    dapat menimbulkan duplikasi.
6.  Nomor transaksi merupakan identitas internal sistem dan **tidak
    ditampilkan pada struk**.
7.  Nomor transaksi tidak boleh digunakan ulang setelah transaksi
    berhasil dibuat, termasuk jika transaksi kemudian di-VOID.

### 8.7 Struk dan printer

Nama perusahaan pada struk: **Pisciculture Farm Indonesia**.

Isi struk hanya memuat informasi berikut:

- Nama perusahaan: Pisciculture Farm Indonesia.
- Tanggal dan waktu transaksi.
- Nama spesies ikan.
- Ukuran ikan.
- Jumlah ikan (ekor).
- Harga per ekor.
- Total pembayaran.
- Metode pembayaran.
- Nama kasir.

Tidak ditampilkan pada struk:

- Nomor transaksi internal.
- Kode batch.
- Data pembeli.
- Nomor referensi transfer.
- Alasan VOID.

Ketentuan pencetakan: 1. Sistem mencoba mencetak struk secara otomatis
setelah transaksi berhasil disimpan. 2. Sistem menyediakan fungsi cetak
ulang. 3. Jika printer tidak terhubung atau proses cetak gagal,
transaksi tetap berstatus berhasil dan tersimpan di database. 4.
Kegagalan cetak tidak boleh menyebabkan transaksi penjualan dibuat
ulang. 5. Cetak ulang hanya dapat dilakukan oleh akun pembuat transaksi. 6. Struk untuk transaksi VOID tidak dapat dicetak ulang. 7. Tata letak
harus dirancang untuk lebar kertas 58 mm dan 80 mm. 8. Perangkat kasir
yang menjadi target penggunaan meliputi Android, iPhone, PC, dan laptop. 9. Model printer dan kompatibilitas Bluetooth lintas perangkat belum
ditetapkan. Kompatibilitas nyata harus diuji menggunakan perangkat dan
printer yang akan dipakai; dokumen ini tidak mengasumsikan semua printer
Bluetooth kompatibel dengan semua perangkat.

## 9. Alur operasional POS

### 9.1 Alur membuat penjualan

1.  Pengguna login dan sistem memverifikasi JWT, status akun, serta
    role.
2.  Sistem memastikan pengguna memiliki role `Owner`,
    `Admin Operasional`, atau `Kasir`.
3.  Kasir membuka halaman POS.
4.  Sistem menampilkan batch berstatus `active` dengan stok terhitung
    lebih dari 0.
5.  Setiap pilihan batch menampilkan spesies, ukuran, kode batch untuk
    identifikasi di layar, stok tersedia, dan harga jual jika tersedia.
6.  Jika harga belum tersedia, batch tidak dapat diproses menjadi
    penjualan.
7.  Kasir memilih satu batch dan memasukkan jumlah ikan dalam ekor.
8.  Jika jumlah melebihi stok tersedia, sistem mengubah tampilan jumlah
    menjadi batas stok dan meminta konfirmasi. Tidak ada transaksi yang
    disimpan sebelum konfirmasi.
9.  Sistem mengambil harga terbaru untuk kombinasi spesies dan ukuran.
10. Sistem menampilkan harga terbaru dan meminta konfirmasi kasir
    sebelum penyimpanan. Jika harga berubah, kasir harus mengonfirmasi
    harga yang baru.
11. Sistem menghitung `total_amount = quantity × unit_price`.
12. Kasir memilih Tunai atau Transfer.
13. Jika Tunai, kasir memasukkan uang diterima. Sistem menghitung
    kembalian dan menolak nilai uang diterima yang kurang dari total.
14. Jika Transfer, kasir mengonfirmasi pembayaran telah diterima. Nomor
    referensi tidak diminta.
15. Kasir mengonfirmasi penyimpanan transaksi.
16. Backend memvalidasi ulang batch, status, stok, harga, pembayaran,
    dan kewenangan dalam transaksi database.
17. Jika valid, sistem menyimpan penjualan secara atomik, membuat nomor
    transaksi, menyimpan snapshot harga, dan mencatat audit.
18. Sistem menghitung ulang stok. Jika stok menjadi 0, batch berubah
    menjadi `completed`.
19. Backend mengembalikan respons sukses.
20. Frontend mencoba mencetak struk otomatis.
21. Jika pencetakan gagal, transaksi tetap sukses. Pengguna dapat
    mencoba cetak ulang sesuai hak akses.

### 9.2 Alur VOID penjualan

1.  Pengguna login dan sistem memverifikasi JWT, status akun, serta role
    POS.
2.  Pengguna membuka transaksi yang akan di-VOID.
3.  Sistem memastikan transaksi ada dan belum pernah di-VOID.
4.  Sistem meminta konfirmasi tindakan VOID. Alasan tidak diwajibkan.
5.  Backend memulai transaksi database dan mengunci batch terkait.
6.  Backend memverifikasi kondisi transaksi serta menghitung dampak
    pembatalan terhadap stok.
7.  Sistem membuat catatan VOID terpisah tanpa mengubah atau menghapus
    catatan penjualan asli.
8.  Sistem mencatat audit pelaku dan waktu VOID.
9.  Sistem menghitung ulang stok berdasarkan transaksi valid.
10. Jika stok kembali lebih dari 0 dan batch sebelumnya `completed`,
    status batch dikembalikan menjadi `active`.
11. Sistem menyelesaikan transaksi database secara atomik.
12. Transaksi yang telah di-VOID tidak dapat di-VOID ulang dan tidak
    dapat dicetak ulang.

### 9.3 Alur pengelolaan harga

1.  Owner atau Admin Operasional membuka pengelolaan harga.
2.  Pengguna memilih spesies dan ukuran ikan.
3.  Pengguna memasukkan harga per ekor dalam Rupiah bulat.
4.  Jika kombinasi belum ada, sistem menambahkan harga.
5.  Jika kombinasi sudah ada, sistem mengubah harga yang berlaku.
6.  Sistem tidak menyediakan riwayat harga katalog.
7.  Perubahan harga tidak mengubah snapshot harga pada transaksi
    penjualan yang telah tersimpan.

## 10. Perhitungan stok dan pengendalian batch

### 10.1 Rumus stok

Prinsip V4.5 tetap digunakan:

`Stok Batch = Total Penerimaan Valid - Total Penjualan Valid - Total Kematian Valid`

Ketentuan POS: - Penjualan valid adalah penjualan yang belum memiliki
catatan VOID. - Penjualan yang sudah di-VOID tidak mengurangi stok. -
Modul POS tidak membuat atau menggantikan modul pencatatan kematian. -
Ketika modul kematian tersedia, transaksi kematian valid tetap menjadi
pengurang stok sesuai rumus V4.5. - Stok tidak boleh negatif. - Stok
dihitung dari transaksi valid, bukan dari angka stok yang dapat diedit
manual.

### 10.2 Status batch

---

Kondisi Status batch

---

Batch masih memiliki stok valid `active`
lebih dari 0 dan belum VOID  
 penerimaan

Stok valid mencapai 0 `completed`

Penerimaan di-VOID sesuai aturan `voided`
V4.5

Penjualan membuat stok menjadi 0 Berubah menjadi `completed`

Penjualan di-VOID dan stok kembali `completed` kembali menjadi
lebih dari 0 `active`

Penjualan di-VOID tetapi stok tetap Tetap `completed`
0

---

Status `voided` pada batch tidak boleh dibalik oleh proses VOID
penjualan. Pengaktifan kembali hanya relevan bagi batch `completed` yang
stok validnya kembali lebih dari 0.

### 10.3 Penguncian dan transaksi bersamaan

Seluruh pembuatan penjualan dan VOID penjualan harus mengikuti prinsip
Master Locking V4.5: - Mengunci baris batch terkait dengan
`SELECT ... FOR UPDATE`. - Memverifikasi batch masih `active` sebelum
penjualan baru disimpan. - Menghitung stok terkini di dalam transaksi
database setelah lock diperoleh. - Mencegah dua kasir menjual stok yang
sama secara bersamaan hingga stok menjadi negatif. - VOID dan penjualan
pada batch yang sama harus diserialisasi melalui lock yang sama. -
Perubahan stok dan status batch harus konsisten dalam satu transaksi
ACID.

## 11. Rancangan data POS (disetujui melalui ADR 0002; belum diimplementasikan)

Bagian ini dibaca bersama ADR 0002 yang mengunci empat tabel POS,
constraints, triggers, kalkulasi stok, dependent transaction guard, dan
granular runtime privileges. Detail implementasi database harus mengikuti
ADR tersebut; belum ada objek POS yang diterapkan ke database.

### 11.1 Tabel `fish_sale_prices`

Menyimpan harga jual terkini berdasarkan spesies dan ukuran.

---

Kolom konseptual Tipe konseptual Aturan

---

`id` UUID Primary key

`species_id` UUID FK ke `fish_species`

`fish_size` VARCHAR(20) Menggunakan enum ukuran
V4.5

`price_per_fish` BIGINT atau NUMERIC Harga Rupiah bulat,
skala 0 wajib lebih dari 0

`created_by` UUID Pengguna pembuat

`created_at` TIMESTAMPTZ Waktu pembuatan

`updated_by` UUID Pengguna terakhir yang
mengubah

`updated_at` TIMESTAMPTZ Waktu perubahan
terakhir

---

Constraint konseptual:

- Kombinasi `(species_id, fish_size)` unik.
- Harga tidak boleh negatif atau nol.
- Role pengelola hanya `Owner` dan `Admin Operasional`.
- Data harga bersifat mutable sesuai keputusan tidak menyimpan riwayat harga.
- Tidak ada operasi hapus harga dalam cakupan keputusan saat ini.

Catatan: batas maksimum nominal harga belum ditentukan dalam sesi
keputusan bisnis dan harus ditetapkan sebelum constraint database final
dibuat.

### 11.2 Tabel `fish_sales`

Menyimpan satu transaksi penjualan untuk satu batch. Karena satu struk
hanya berisi satu batch, rancangan awal tidak membutuhkan tabel detail
item terpisah.

---

Kolom konseptual Tipe konseptual Aturan

---

`id` UUID Primary key

`sale_code` VARCHAR Nomor
`PFI-SAL-YYYYMMDD-XXX`,
unik

`batch_id` UUID FK ke `batches`

`quantity` INTEGER Jumlah terjual dalam
ekor, lebih dari 0

`unit_price` BIGINT atau NUMERIC Snapshot harga Rupiah per
skala 0 ekor

`total_amount` BIGINT atau NUMERIC Snapshot total pembayaran
skala 0

`payment_method` VARCHAR `cash` atau `transfer`

`cash_received` BIGINT atau NUMERIC Wajib untuk Tunai; tidak
skala 0 berlaku untuk Transfer

`change_amount` BIGINT atau NUMERIC Hasil perhitungan Tunai;
skala 0 tidak berlaku untuk
Transfer

`created_by` UUID Pengguna pembuat
transaksi dari JWT

`created_at` TIMESTAMPTZ Waktu transaksi

---

Constraint dan validasi konseptual: - `quantity` bilangan bulat
positif. - `unit_price` adalah snapshot harga terbaru yang
dikonfirmasi. - `total_amount` harus sama dengan
`quantity × unit_price`. - `cash_received >= total_amount` untuk metode
Tunai. - `change_amount = cash_received - total_amount` untuk metode
Tunai. - Untuk Transfer, pembayaran dianggap lunas setelah kasir
mengonfirmasi penerimaan; nomor referensi tidak diwajibkan. - Tidak ada
kolom data pelanggan. - Tidak ada pengubahan atau penghapusan catatan
penjualan setelah commit. - Status VOID ditentukan dari keberadaan
catatan pada `fish_sale_voids`, bukan dengan mengubah atau menghapus
baris penjualan.

### 11.3 Tabel `fish_sale_voids`

Menyimpan reversal/VOID penjualan secara terpisah.

---

Kolom konseptual Tipe konseptual Aturan

---

`id` UUID Primary key

`sale_id` UUID FK ke `fish_sales`,
unik agar satu
penjualan hanya di-VOID
satu kali

`voided_by` UUID Pengguna pelaku dari
JWT

`voided_at` TIMESTAMPTZ Waktu VOID

---

Ketentuan: - `sale_id` unik. - Tidak ada `reason` wajib untuk VOID
penjualan. - Catatan VOID append-only. - VOID tidak mengubah data asli
`fish_sales`. - Catatan VOID menyebabkan jumlah penjualan tersebut
dikeluarkan dari perhitungan stok valid.

### 11.4 Sequence nomor penjualan

Rancangan awal menggunakan sequence harian terpisah untuk nomor
penjualan, misalnya `sale_daily_sequences`.

- Sequence berdasarkan tanggal transaksi pada `Asia/Jakarta`.
- Sequence global untuk semua spesies dan batch pada tanggal yang
  sama.
- Tidak memiliki batas 999.
- Increment harus atomik dan tahan terhadap request bersamaan.
- Nomor yang sudah berhasil dialokasikan tidak digunakan ulang.
- Format minimal tiga digit dan bertambah panjang sesuai kebutuhan.

Nama tabel sequence dan tipe integer final perlu dipastikan pada desain
database rinci.

### 11.5 Perluasan tabel `users`, `audit_logs`, dan `idempotency_keys`

Perubahan yang diperlukan untuk mendukung POS:

- Constraint `users.role` perlu menerima `Kasir` selain tiga role V4.5.
- Matriks RBAC V4.5 perlu diperluas dengan hak POS, tanpa menghapus hak penerimaan yang sudah ada.
- `audit_logs.action` perlu diperluas untuk merekam tindakan POS seperti pembuatan penjualan dan VOID penjualan.
- Seluruh mutasi POS harus memakai `Idempotency-Key` UUIDv4 dan mekanisme idempotency V4.5.
- Mutasi daftar harga juga perlu diamankan melalui autentikasi dan otorisasi. Detail pencatatan audit perubahan harga perlu diputuskan pada
  kontrak teknis karena keputusan bisnis menyatakan tidak menyimpan
  riwayat harga katalog.

## 12. Kontrak API POS (`APPROVED — OWNER`, ADR 0002)

Kontrak endpoint, request/response, pagination/filter, idempotency, RBAC,
dan kode error POS yang normatif dipelihara di
[docs/pos-api-contract.md](docs/pos-api-contract.md). Route memakai prefix
`/api/v1/pos/*`; kontrak lama yang memakai `/api/v1/fish-sales` tidak lagi
menjadi acuan implementasi.

## 13. Format struk POS

### 13.1 Konten struk

```text
PISCICULTURE FARM INDONESIA
--------------------------------
Tanggal : [tanggal dan waktu]
Spesies : [nama spesies]
Ukuran  : [ukuran ikan]
Jumlah  : [jumlah] ekor
Harga   : Rp [harga]/ekor
--------------------------------
TOTAL   : Rp [total]
Bayar   : [Tunai/Transfer]
Kasir   : [nama kasir]
--------------------------------
       TERIMA KASIH
```

Contoh di atas hanya ilustrasi tata letak konten. Struk hanya memuat
sembilan field yang disetujui ADR 0002. Nomor transaksi internal dan kode
batch tidak dicetak; berat dan watermark VOID juga tidak ditambahkan.

### 13.2 Ukuran kertas dan kegagalan cetak

- Layout harus memiliki varian lebar 58 mm dan 80 mm.
- Sistem menyimpan transaksi lebih dahulu sebelum proses cetak.
- Hasil cetak tidak menjadi prasyarat keberhasilan transaksi.
- Jika cetak gagal, status transaksi tetap berhasil dan fungsi cetak
  ulang tersedia bagi pembuat transaksi.
- Browser print CSS 58 mm/80 mm dengan dialog cetak sistem adalah baseline
  yang disetujui ADR 0002 tanpa driver/protokol khusus aplikasi. OS masih
  dapat memerlukan driver atau dukungan printer native. Perangkat Android,
  iPhone, PC, dan laptop tetap memerlukan verifikasi printer fisik GPOS-04
  sebelum kompatibilitasnya dinyatakan didukung.

## 14. Validasi bisnis dan error handling POS

Daftar berikut adalah kebutuhan validasi konseptual. Kode error final
harus diselaraskan dengan standar error V4.5 saat kontrak API dikunci.

---

Kondisi Hasil yang diharapkan

---

Role tidak memiliki akses POS Ditolak `403 FORBIDDEN`

Batch tidak ditemukan Ditolak `404 BATCH_NOT_FOUND`

Batch tidak `active` Ditolak `409 BATCH_NOT_ACTIVE`

Stok tersedia 0 Tidak dapat dijual

Jumlah penjualan tidak valid atau Ditolak sebagai payload tidak valid
\<= 0

Jumlah melebihi stok Jumlah dibatasi ke stok dan
konfirmasi kasir diwajibkan

Kasir menolak konfirmasi jumlah Tidak ada transaksi tersimpan
yang dibatasi

Harga belum tersedia Penjualan ditolak sampai harga
diatur

Harga berubah sebelum commit Tampilkan harga terbaru dan minta
konfirmasi ulang

Harga tidak cocok dengan harga Tolak atau minta refresh/konfirmasi
terkini yang dikonfirmasi ulang; jangan menyimpan harga stale

Uang tunai diterima kurang dari Ditolak
total

Transfer belum dikonfirmasi sebagai Tidak boleh disimpan sebagai
diterima penjualan lunas

Penjualan sudah di-VOID VOID kedua ditolak

Penjualan tidak ditemukan `404`

Idempotency key tidak valid `400 INVALID_IDEMPOTENCY_KEY`

Idempotency key sama dengan payload `409 IDEMPOTENCY_MISMATCH`
berbeda

Printer tidak tersedia/gagal Transaksi tetap berhasil; tampilkan
mencetak kegagalan cetak secara terpisah

Pengguna bukan pembuat transaksi Ditolak `403 FORBIDDEN`
mencoba cetak ulang

Cetak ulang transaksi VOID Ditolak

Dua kasir menjual stok batch yang Locking dan validasi stok mencegah
sama secara bersamaan stok negatif

---

## 15. Keamanan, imutabilitas, idempotency, dan audit POS

1.  Autentikasi tetap menggunakan JWT terverifikasi.
2.  Identitas `created_by` dan `voided_by` wajib berasal dari claims
    JWT, bukan input frontend.
3.  Semua mutasi penjualan dan VOID memakai `Idempotency-Key` UUIDv4
    sesuai pola V4.5.
4.  Penyimpanan transaksi penjualan, audit, sequence nomor transaksi,
    dan penyelesaian idempotency harus atomik.
5.  Data `fish_sales` dan `fish_sale_voids` bersifat append-only setelah
    commit.
6.  Perubahan harga katalog diperbolehkan melalui operasi tambah/ubah
    yang diotorisasi.
7.  Snapshot harga dan total transaksi tidak boleh berubah ketika
    katalog harga diperbarui.
8.  Semua proses penjualan dan VOID mengunci batch terkait menggunakan
    `SELECT ... FOR UPDATE`.
9.  Kegagalan penyimpanan audit harus membatalkan transaksi
    penjualan/VOID dalam transaksi database yang sama.
10. Kegagalan printer tidak termasuk kegagalan transaksi database dan
    tidak boleh membatalkan transaksi yang sudah commit.
11. Hak akses database runtime harus diperluas secara granular untuk
    tabel POS. Runtime tidak boleh memperoleh hak UPDATE/DELETE pada
    tabel transaksi dan audit append-only.
12. Detail trigger, constraint, index, dan privilege POS harus
    difinalisasi pada rancangan database sebelum implementasi.

## 16. Skenario QA POS yang wajib dirancang

Daftar ini adalah cakupan uji minimum untuk disusun menjadi test case
bernomor pada tahap kontrak QA final.

### 16.1 Penjualan dan stok

- Penjualan valid untuk satu batch dan satu spesies/ukuran.
- Penjualan sebagian dari stok.
- Penjualan tepat menghabiskan stok dan mengubah batch menjadi
  `completed`.
- Jumlah melebihi stok dibatasi dan membutuhkan konfirmasi.
- Kasir membatalkan konfirmasi jumlah yang dibatasi; tidak ada
  transaksi tersimpan.
- Batch `completed` tidak dapat dipilih untuk penjualan.
- Batch `voided` tidak dapat dipilih untuk penjualan.
- Harga belum tersedia; penjualan ditolak.
- Harga diperbarui sebelum commit; kasir harus mengonfirmasi harga
  terbaru.
- Dua transaksi bersamaan pada batch yang sama tidak boleh
  menghasilkan stok negatif.
- Snapshot harga transaksi lama tidak berubah setelah katalog
  diperbarui.

### 16.2 Pembayaran

- Tunai tepat.
- Tunai lebih besar dari total dan kembalian dihitung benar.
- Tunai kurang dari total ditolak.
- Transfer yang dikonfirmasi diterima berhasil disimpan.
- Transfer tidak meminta nomor referensi.
- Tidak ada transaksi pembayaran sebagian.

### 16.3 VOID dan status batch

- VOID transaksi penjualan mengembalikan stok.
- VOID terhadap batch `completed` mengaktifkan kembali batch ketika
  stok valid menjadi lebih dari 0.
- VOID tidak mengubah data asli penjualan.
- VOID kedua terhadap penjualan yang sama ditolak.
- VOID dapat dilakukan tanpa batas waktu.
- Semua role POS dapat melakukan VOID.
- Kepala Budidaya tidak dapat melakukan VOID penjualan melalui POS.
- VOID penjualan tidak mewajibkan alasan.
- Transaksi VOID tidak dapat dicetak ulang.
- VOID dan penjualan bersamaan pada batch yang sama tetap konsisten.

### 16.4 Hak akses dan cetak

- Owner, Admin Operasional, dan Kasir dapat membuka POS.
- Kepala Budidaya tidak dapat membuka POS.
- Owner dan Admin Operasional dapat menambah dan mengubah harga.
- Kasir tidak dapat mengelola harga.
- Semua role POS dapat melihat seluruh transaksi.
- Hanya pembuat transaksi yang dapat mencetak ulang.
- Cetak otomatis dijalankan setelah commit.
- Printer tidak terhubung: transaksi tetap berhasil.
- Kegagalan cetak ulang tidak membuat transaksi baru.
- Layout 58 mm dan 80 mm diperiksa.
- Kompatibilitas perangkat Android, iPhone, PC, dan laptop
  diverifikasi menggunakan printer aktual.

### 16.5 Integritas dan regresi

- Idempotency retry tidak menggandakan penjualan.
- Idempotency key yang sama dengan payload berbeda ditolak.
- Kegagalan audit menyebabkan rollback penjualan/VOID.
- Kegagalan database tidak menghasilkan transaksi setengah jadi.
- Nomor penjualan unik untuk request bersamaan dan dapat melampaui 999
  per hari.
- Seluruh 32 test case V4.5 untuk penerimaan dan VOID tetap lulus
  setelah perluasan POS.

## 17. Status keputusan teknis POS (keputusan pemilik produk & item terbuka)

Keputusan bisnis utama POS telah dijawab, dan sebagian besar keputusan teknis telah ditetapkan oleh pemilik produk pada `architecture.md` (`APPROVED — OWNER`), sementara item yang tersisa wajib dikunci pada `Gate POS` sebelum coding:

1.  **Batas maksimum harga per ekor (`TBD-01` — `APPROVED — OWNER`):** ditetapkan minimal **Rp 1** dan maksimum **Rp 10.000.000** per ekor menggunakan tipe `BIGINT` (bilangan bulat Rupiah tanpa desimal).
2.  **Pencatatan audit perubahan daftar harga (`TBD-02` — `APPROVED — OWNER`, amendemen ADR 0002):** penambahan harga dicatat dengan `action = 'CREATE_SALE_PRICE'`; perubahan harga dicatat dengan `action = 'UPDATE_SALE_PRICE'`. Keduanya hanya menyimpan aktor (`actor_id`) dan waktu (`created_at`), dengan `old_values = NULL` dan `new_values = NULL` (tanpa riwayat harga katalog).
3.  **Arsitektur cetak thermal (`TBD-03` — `APPROVED — OWNER`, ADR 0002):** browser print CSS 58/80 mm dan dialog cetak sistem menjadi baseline; uji perangkat fisik lintas OS tetap wajib pada `GPOS-04` sebelum klaim kompatibilitas.
4.  **Kontrak API POS (`TBD-04` — `APPROVED — OWNER`, ADR 0002):** route, request/response, error, pagination, idempotency, dan refresh/konfirmasi harga dikunci pada `docs/pos-api-contract.md`.
5.  **Detail sequence penjualan (`TBD-05` — `APPROVED — OWNER`):** ditetapkan menggunakan tabel `sale_daily_sequences` (`sale_date DATE PRIMARY KEY`, `last_number BIGINT NOT NULL CHECK (last_number >= 0)`) dengan padding minimal tiga digit dan bertambah panjang melewati 999.
6.  **Audit action, DDL, dan hak database (`TBD-06` — `APPROVED — OWNER`, ADR 0002 amendment):** empat tabel POS, kalkulasi stok, trigger, guard transaksi turunan, index, action (`CREATE_SALE`, `VOID_SALE`, `CREATE_SALE_PRICE`, `UPDATE_SALE_PRICE`), dan granular privileges runtime telah disetujui untuk implementasi.

## 18. Gerbang persetujuan sebelum implementasi

Implementasi POS belum boleh dimulai hanya berdasarkan dokumen rancangan
ini. Tahapan persetujuan yang disarankan:

1.  Review seluruh keputusan bisnis POS pada Bagian 8.
2.  Review alur POS pada Bagian 9.
3.  Review perhitungan stok, VOID, dan locking pada Bagian 10.
4.  Review dan kunci rancangan data pada Bagian 11.
5.  Review dan kunci kontrak API pada Bagian 12.
6.  Review format struk dan strategi printer pada Bagian 13.
7.  Review validasi, keamanan, idempotency, audit, dan QA pada Bagian
    14--16.
8.  Selesaikan detail yang belum dikunci pada Bagian 17.
9.  Setelah persetujuan eksplisit, barulah dokumen ini dapat menjadi
    dasar migrasi database, backend, frontend, dan QA POS.

**Prinsip akhir:** V4.5 untuk Penerimaan Ikan tetap menjadi aturan dasar
yang tidak berubah. POS adalah perluasan MVP yang mengikuti prinsip
identitas batch, computed stock, append-only, VOID/reversal, RBAC,
idempotency, ACID, audit, dan master locking dari blueprint utama.
