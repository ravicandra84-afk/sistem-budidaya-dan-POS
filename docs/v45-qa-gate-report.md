# Laporan QA Gate V4.5 — P6-03

| Item | Hasil |
| --- | --- |
| Task | P6-03 — Jalankan 32 Test Cases V4.5; P6-04 — Performance dan security |
| Tanggal eksekusi | 2026-11-17 |
| Database test | `pfi_test`, PostgreSQL 16, lokal |
| Perintah P6-03 (run terbaru) | `RUN_V45_DB_TESTS=1 npm run test --workspace @pfi/api -- --runInBand` |
| Hasil Jest (run terbaru) | 10 suite lulus; 121 test lulus; 0 diskip; 0 gagal; 21.915 s |
| Hasil TC resmi (run terbaru) | 32 PASS; 0 PARTIAL; 0 BLOCKED; 0 FAIL |
| Status P6-03 | PASS — seluruh 32 TC lulus pada PostgreSQL test |
| Benchmark P6-04 terbaru | 50 request; 0 error; p50 625.26 ms; p95 931.10 ms; p99 973.60 ms |
| Checks terbaru | `typecheck`, `lint`, dan `build` lulus; test teardown mengosongkan seluruh tabel `pfi_test` |
| Migrasi `pfi_db` | 3 migrasi ditemukan; seluruhnya up to date, termasuk `20261117000000_v45_computed_stock_guard` |
| Backup/restore rehearsal | Lulus menurut bukti terminal operator: restore ke `pfi_restore_check` menghasilkan 8 tabel, 6 trigger, 6 spesies; database dan dump dibersihkan |
| Status P6-04 | PARTIAL — static checks lulus; benchmark tersedia pada host lokal, bukan staging terkelola |
| Status resmi Gate V4.5 | APPROVED / PASS — bukti backup/restore lokal diterima untuk sign-off berdasarkan instruksi eksplisit pada sesi ini |

Semua TC-01 sampai TC-32 dijalankan pada [suite kontrak V4.5](../apps/api/test/v45-contract.e2e.spec.ts). Run final menghasilkan 10 suite lulus dan 121 test lulus tanpa skip atau failure. TC-20/28 memakai dependency guard yang diinjeksi dalam integration test, tanpa tabel atau endpoint POS. TC-22 memverifikasi stok positif pada API dan database, stok nol pada kalkulasi domain, serta penolakan status `completed` saat stok masih positif.

## Hasil Per Test Case

| ID | Skenario resmi | Hasil aktual | Referensi / bukti |
| --- | --- | --- | --- |
| TC-01 | Penerimaan lengkap valid membuat batch, receipt, audit, dan idempotency secara atomik | PASS | `TC-01` — suite kontrak V4.5 |
| TC-02 | Payload invalid ditolak `400 INVALID_PAYLOAD` tanpa menulis data | PASS | `TC-02` — suite kontrak V4.5 |
| TC-03 | Quantity 1 dan 1.000.000 diterima; 1.000.001 ditolak | PASS | `TC-03` — suite kontrak V4.5 |
| TC-04 | Token hilang, kedaluwarsa, atau invalid ditolak `401` | PASS | `TC-04` — suite kontrak V4.5 |
| TC-05 | Role V4.5 membuat receipt sesuai hak; Kepala Budidaya ditolak saat VOID | PASS | `TC-05` — suite kontrak V4.5; mengikuti keputusan Owner terbaru 2026-11-17 |
| TC-06 | Retry payload identik dengan key sama mengembalikan response cached | PASS | `TC-06` — suite kontrak V4.5 |
| TC-07 | 50 request bersamaan menghasilkan 50 sequence unik berurutan tanpa error | PASS | `TC-07` — suite kontrak V4.5; metrik aktual di bawah |
| TC-08 | Kegagalan insert receipt me-rollback idempotency, sequence, dan batch | PASS | `TC-08` — suite kontrak V4.5 |
| TC-09 | Setiap batch committed memiliki tepat satu receipt | PASS | `TC-09` — suite kontrak V4.5 |
| TC-10 | Regresi alur utama create, VOID, dan histori tetap sesuai V4.5 | PASS | `TC-10` — suite kontrak V4.5 |
| TC-11 | Spesies nonaktif ditolak `422 SPECIES_NOT_ACTIVE` | PASS | `TC-11` — suite kontrak V4.5 |
| TC-12 | Dua request pertama pada tanggal baru menginisialisasi sequence aman | PASS | `TC-12` — suite kontrak V4.5 |
| TC-13 | Kegagalan insert audit me-rollback seluruh transaksi penerimaan | PASS | `TC-13` — suite kontrak V4.5 |
| TC-14 | Normalisasi null/omitted dan decimal ekuivalen menghasilkan hash sama | PASS | `TC-14` — suite kontrak V4.5 |
| TC-15 | Idempotency key sama pada user berbeda diproses terpisah | PASS | `TC-15` — suite kontrak V4.5 |
| TC-16 | Uniqueness email case-insensitive ditegakkan database | PASS | `TC-16` — suite kontrak V4.5 |
| TC-17 | Deferred trigger menolak batch tanpa receipt saat commit | PASS | `TC-17` — suite kontrak V4.5 |
| TC-18 | Lock timeout dipetakan ke `503 DATABASE_LOCK_TIMEOUT` | PASS | `TC-18` — suite kontrak V4.5 |
| TC-19 | Tanggal masa depan berdasarkan `Asia/Jakarta` ditolak | PASS | `TC-19` — suite kontrak V4.5 |
| TC-20 | VOID pada batch dengan transaksi turunan ditolak `409 HAS_DEPENDENT_TRANSACTIONS` | PASS | `TC-20` — dependency guard stub diinjeksi; status batch dan receipt tetap aktif/tidak VOID |
| TC-21 | Runtime role ditolak saat UPDATE/DELETE receipt dan audit historis | PASS | `TC-21` — suite kontrak V4.5 |
| TC-22 | Stok terhitung diverifikasi; status ilegal/enum dan `completed` saat stok > 0 ditolak | PASS | `TC-22` — API `current_stock`, fungsi SQL, kalkulasi receipt VOID, serta status guard |
| TC-23 | Sampel berat minimum `0.01` diterima | PASS | `TC-23` — suite kontrak V4.5 |
| TC-24 | Sampel berat maksimum `100000.00` diterima | PASS | `TC-24` — suite kontrak V4.5 |
| TC-25 | Sampel berat `100000.01` ditolak | PASS | `TC-25` — suite kontrak V4.5 |
| TC-26 | Modal pembelian dan pengiriman maksimum diterima | PASS | `TC-26` — suite kontrak V4.5 |
| TC-27 | Modal pembelian di atas maksimum ditolak | PASS | `TC-27` — suite kontrak V4.5 |
| TC-28 | VOID diserialisasi terhadap insert transaksi turunan pada batch yang sama | PASS | `TC-28` — writer stub dan VOID bersaing pada `SELECT ... FOR UPDATE` batch yang sama |
| TC-29 | Dua retry VOID identik bersamaan menghasilkan satu eksekusi dan satu cached response | PASS | `TC-29` — suite kontrak V4.5 |
| TC-30 | Sequence harian pada 999 ditolak `422 BATCH_SEQUENCE_EXHAUSTED` | PASS | `TC-30` — suite kontrak V4.5 |
| TC-31 | Header `Idempotency-Key` hilang/bukan UUIDv4 ditolak | PASS | `TC-31` — suite kontrak V4.5 |
| TC-32 | VOID kedua dengan key berbeda ditolak `409 BATCH_NOT_ACTIVE` | PASS | `TC-32` — suite kontrak V4.5 |

## Bukti Eksekusi dan Isolasi

- Run P6-03 final menggunakan command pada tabel ringkasan. Output Jest: `Test Suites: 10 passed, 10 total`; `Tests: 121 passed, 121 total`; `Snapshots: 0 total`; `Time: 17.365 s`.
- Preflight read-only (tanpa mencetak URL/password) mengonfirmasi `TEST_DATABASE_URL` adalah `localhost/pfi_test` dengan role `postgres`. `DATABASE_URL` runtime adalah `localhost/pfi_db` dengan role `pfi_app_runtime`; helper `getLocalTestRuntimeDatabaseUrl()` memetakan koneksi runtime suite ke `pfi_test`.
- Run terbaru: `RUN_V45_DB_TESTS=1 npm run test --workspace @pfi/api -- --runInBand`; hasil Jest 10/10 suite dan 121/121 test lulus, tanpa skip atau failure.
- Snapshot read-only pasca-run `pfi_db`: `users=1`, `fish_species=6`, `batch_daily_sequences=1`, `batches=1`, `incoming_fish=1`, `incoming_fish_voids=1`, `idempotency_keys=2`, `audit_logs=2`. Seluruh delapan tabel pada `pfi_test` berisi 0 baris setelah teardown.
- TC-07 final mencatat 50 request, 50 batch code unik (`PFI-BCH-20000207-001` sampai `PFI-BCH-20000207-050`), error rate 0%, p50 625.26 ms, p95 931.10 ms, dan p99 973.60 ms. Assertion test p95 <= 1.500 ms lulus. Host dev lokal terukur 4 vCPU dan `MemTotal=7,812,100 kB` (sekitar 7.45 GiB RAM); kapasitas nominal memenuhi minimum 2 vCPU/4 GB, tetapi lingkungan ini bukan staging terkelola.
- Sesudah teardown, query read-only pada `pfi_test` menunjukkan 0 baris di seluruh tabel `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, dan `audit_logs`.
- Semua suite memakai URL test yang divalidasi sebagai `pfi_test`; tidak ada operasi test yang menargetkan `pfi_db`.

## Verifikasi Akhir Gate

TC-01 sampai TC-32 telah PASS. TC-20/28 memakai interface dependency yang diinjeksi dan test writer concurrent yang mengunci baris batch yang sama. Provider default V4.5 mengembalikan `false`, sesuai kondisi tidak adanya sumber dependent transaction yang approved. Tidak ada DDL atau endpoint POS, mortalitas, maupun pakan.

Bukti terminal yang disampaikan operator untuk rehearsal: backup `pfi_db`, restore dengan `pg_restore --exit-on-error --no-owner` ke `pfi_restore_check`, verifikasi `8 tables | 6 triggers | 6 species`, lalu `dropdb` dan cleanup dump. Rehearsal dijalankan pada host Pop!_OS lokal, bukan staging terkelola. Sesuai instruksi eksplisit pada sesi ini, bukti lokal tersebut diterima untuk Gate V4.5 sign-off; pengujian pada staging terkelola tidak diverifikasi.

## P6-04 — Performance dan Security

### Benchmark Konkurensi

Benchmark terbaru dijalankan melalui TC-07 pada `pfi_test` dengan fixture 100.004 record saat pengukuran dimulai. Host dev lokal terukur 4 vCPU dan sekitar 7.45 GiB RAM. Resource nominal memenuhi minimum 2 vCPU/4 GB, namun lingkungan ini bukan staging terkelola.

Perintah: `RUN_V45_DB_TESTS=1 npm run test --workspace @pfi/api -- --runInBand --testNamePattern='TC-07' --verbose --silent=false`.

| Metrik | Hasil aktual | Kriteria | Status |
| --- | ---: | ---: | --- |
| Request bersamaan | 50 | 50 | PASS |
| Batch code unik | 50/50 (`001`–`050`) | 0 duplikasi | PASS |
| Error/deadlock | 0 (error rate 0%) | 0 | PASS |
| p50 | 625.26 ms | Dicatat | PASS |
| p95 | 931.10 ms | <= 1,500 ms | PASS |
| p99 | 973.60 ms | Dicatat | PASS |
| Throughput | 50.24 request/detik | Dicatat | PASS |
| Durasi keseluruhan 50 request | 995.23 ms | Dicatat | PASS |

Suite mengukur sequence codes, response status, error codes, dan latensi tiap request; output `V45_BENCHMARK` mencatat error rate 0%, `errors: []`, serta 50 batch code unik dari `PFI-BCH-20000207-001` sampai `PFI-BCH-20000207-050`. Assertion p95 <= 1.500 ms lulus. Sesudah test, delapan tabel V4.5 di `pfi_test` kembali berisi 0 baris. `getLocalTestDatabaseUrl()` memaksa `TEST_DATABASE_URL` ke localhost `pfi_test`; helper runtime mengalihkan URL role `pfi_app_runtime` dari `pfi_db` ke database test. Tidak ada mutasi benchmark yang diarahkan ke `pfi_db`.

Output metrik aktual:

```json
{
	"requests": 50,
	"durationMs": 995.23,
	"throughputRequestsPerSecond": 50.24,
	"p50Ms": 625.26,
	"p95Ms": 931.1,
	"p99Ms": 973.6,
	"errorRatePercent": 0,
	"errors": [],
	"uniqueBatchCodes": 50,
	"firstCode": "PFI-BCH-20000207-001",
	"lastCode": "PFI-BCH-20000207-050",
	"databaseRecordsAtStart": 100004
}
```

### Security Checklist

| Pemeriksaan | Bukti | Status |
| --- | --- | --- |
| Dependency produksi | `npm audit --omit=dev` — 0 vulnerabilities | PASS |
| Workspace checks | `npm run typecheck`, `npm run lint`, dan `npm run build` dijalankan; seluruh workspace selesai tanpa error | PASS |
| Migrasi test | `npm run db:test:migrate --workspace @pfi/api`; 3 migrations ditemukan dan migrasi computed-stock berhasil diterapkan pada `pfi_test` | PASS |
| Migrasi operasional | `prisma migrate status` pada `pfi_db`: 3 migrasi ditemukan dan database schema up to date, termasuk `20261117000000_v45_computed_stock_guard` | PASS; status diperiksa read-only |
| Seed test | `npm run db:test:seed --workspace @pfi/api`; 6 spesies unik terverifikasi | PASS |
| Owner provisioning | `npm run db:provision-owner` dijalankan dua kali; kedua run no-op. Fingerprint seluruh field sebelum/sesudah identik | PASS |
| Backup/restore rehearsal | Operator melaporkan `pg_dump`/`pg_restore` sukses ke `pfi_restore_check`; terverifikasi 8 tabel, 6 trigger, 6 spesies; `dropdb` dan cleanup dump selesai | PASS untuk sign-off ini; dilakukan di host lokal, bukan staging terkelola |
| Hardcoded secret pada source aplikasi | Pattern scan pada 67 file tracked di `apps/api/src`, `apps/api/prisma`, `apps/web/src`, dan `packages/shared/src`; tidak ditemukan private key, credentialed database URL, atau assignment secret literal. `.env.example` hanya berisi placeholder; test-only dummy values tidak diperlakukan sebagai credential produksi. | PASS untuk source ter-scan; bukan pengganti secret scanning pada CI/repository hosting |
| `pfi_app_runtime` least privilege | Read-only `pfi_db`: `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`; `has_schema_privilege('pfi_app_runtime', 'public', 'CREATE')=false`. Granular DML dan penolakan mutation historis juga diuji pada `pfi_test`. | PASS |
| Auth rate limit | `AuthController` membatasi 5 request per 60 detik; [auth.e2e.spec.ts](../apps/api/test/auth.e2e.spec.ts) menguji respons `429 RATE_LIMIT_EXCEEDED`. | PASS |
| Input boundary | [receiving-schemas.spec.ts](../apps/api/test/receiving-schemas.spec.ts), [core-api.e2e.spec.ts](../apps/api/test/core-api.e2e.spec.ts), dan TC-02/03/11/19/23–27 menguji rentang, enum, format, tanggal bisnis, dan field tambahan. | PASS untuk batas penerimaan yang diimplementasikan |
| Error sanitization | `core-api.e2e.spec.ts` dan `auth.e2e.spec.ts` memastikan SQL, stack, dan detail koneksi internal tidak muncul pada respons; error DB dipetakan ke envelope publik. | PASS |
| Audit dan idempotency atomik | TC-01/08/13/29 serta guard DB membuktikan commit/rollback, retry cached, dan audit dalam transaksi. TC-20/28 juga PASS melalui dependency stub dan row lock. | PASS |

### Gate V4.5 Sign-off

**Keputusan resmi: Gate V4.5 — APPROVED / PASS.** Seluruh 32 TC lulus; suite ulang menghasilkan 10 suite dan 121 test lulus; `typecheck`, `lint`, dan `build` lulus; `pfi_db` up to date pada 3 migrasi; role runtime tidak memiliki hak `CREATE` schema; 8 tabel V4.5, 6 trigger aktif, 1 akun Owner aktif, dan 0 tabel POS terverifikasi. Rehearsal backup/restore lulus dengan hasil 8 tabel, 6 trigger, dan 6 spesies. `pfi_test` bersih setelah suite.

Catatan lingkungan: checklist implementation plan menyebut staging untuk backup/restore. Bukti yang diberikan berasal dari host Pop!_OS lokal; pengujian staging terkelola belum diverifikasi dan diterima sebagai pengecualian untuk sign-off ini sesuai instruksi eksplisit pada sesi ini. P6-04 tetap PARTIAL hanya untuk kriteria benchmark pada staging terkelola.

Tidak ada DDL tabel atau endpoint POS yang dibuat. Database function/guard yang diterapkan hanya untuk computed stock V4.5. Gate POS siap memasuki pembahasan spesifikasi teknis untuk `TBD-03`, `TBD-04`, dan `TBD-06`; status TBD tetap belum diselesaikan dan tidak ada implementasi POS yang dimulai.