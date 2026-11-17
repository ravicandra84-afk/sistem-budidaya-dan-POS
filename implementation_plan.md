# IMPLEMENTATION PLAN

# Sistem Manajemen Operasional Pisciculture Farm Indonesia (PFI)

| Informasi         | Nilai                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| Dokumen           | `implementation_plan.md`                                                     |
| Versi             | 1.0                                                                          |
| Status            | Draft rencana eksekusi berdasarkan PRD 1.0 dan Master Blueprint V4.5         |
| Produk            | Sistem Manajemen Operasional Pisciculture Farm Indonesia (PFI)               |
| Zona waktu bisnis | `Asia/Jakarta` (UTC+7)                                                       |
| Basis database    | PostgreSQL 13+                                                               |
| Autentikasi       | JWT terverifikasi                                                            |
| Pola transaksi    | ACID, idempotency UUIDv4, audit log, dan locking sesuai kontrak              |
| Dokumen acuan     | `master_blueprint_api_contract_pfi_main.md`, `prd.md`, dan `architecture.md` |

> **Tujuan dokumen:** menerjemahkan requirement dan kontrak yang telah disetujui menjadi urutan pekerjaan yang kecil, terukur, dan dapat dikerjakan dalam sesi AI terpisah. Dokumen ini bukan pengganti PRD atau Master Blueprint dan tidak boleh digunakan untuk mengubah keputusan di kedua dokumen tersebut.

---

# 1. Prinsip dan aturan eksekusi

## 1.1 Hierarki sumber kebenaran

Gunakan urutan berikut ketika menemukan perbedaan dokumen:

1. Keputusan bisnis eksplisit pemilik produk.
2. Master Blueprint V4.5 untuk modul Penerimaan Ikan dan VOID Penerimaan.
3. Bagian perluasan POS yang telah disetujui untuk keputusan bisnis Ikan Keluar.
4. `prd.md` untuk kebutuhan produk, halaman, user flow, dan acceptance criteria.
5. `architecture.md` untuk struktur arsitektur, skema database, aturan konkurensi/keamanan, dan keputusan pemilik produk (`APPROVED — OWNER`).
6. `implementation_plan.md` untuk urutan dan pembagian pekerjaan.
7. Kode aplikasi, desain UI, atau usulan AI tidak boleh mengesampingkan dokumen di atas.

Jika ada konflik, hentikan hanya pekerjaan yang terdampak. Laporkan nama dokumen, bagian/Requirement ID, aturan yang bertentangan, dampak, dan keputusan yang dibutuhkan. Jangan memilih salah satu secara sepihak.

## 1.2 Status keputusan

| Status                 | Makna                                                                                  | Cara implementasi                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `LOCKED — V4.5`        | Aturan Penerimaan dan VOID Penerimaan yang telah disetujui.                            | Implementasikan sesuai blueprint; perubahan perlu persetujuan pemilik produk.             |
| `LOCKED — BUSINESS`    | Keputusan bisnis POS yang telah dikonfirmasi.                                          | Perilaku bisnis tidak boleh diubah. Detail teknis tetap harus dikunci sebelum coding POS. |
| `APPROVED — OWNER`     | Keputusan arsitektur atau teknis yang disetujui pemilik produk pada `architecture.md`. | Berlaku sebagai acuan implementasi dan siap dikunci ke kontrak teknis final.              |
| `PROPOSED — TECHNICAL` | Rancangan teknis yang belum disetujui sebagai kontrak.                                 | Boleh dianalisis dan direview; jangan dianggap final atau langsung dimigrasikan.          |
| `TBD — NEEDS DECISION` | Keputusan yang belum tersedia.                                                         | Buat catatan dan minta keputusan. Dilarang mengisi dengan tebakan.                        |
| `OUT OF SCOPE`         | Tidak termasuk MVP saat ini.                                                           | Jangan dibangun kecuali ruang lingkup diubah secara resmi.                                |

## 1.3 Aturan satu tugas satu sesi

- Satu sesi AI hanya mengerjakan **satu Task ID** yang tertulis pada rencana ini.
- AI wajib membaca bagian PRD dan Master Blueprint yang relevan sebelum mengubah kode.
- Sebelum coding, AI harus menyebutkan Task ID, tujuan, requirement terkait, file yang diperkirakan terdampak, dan cara verifikasi.
- AI harus memeriksa struktur repository dan kode aktual terlebih dahulu. Jangan menganggap file, framework, tabel, endpoint, atau fitur sudah ada sebelum memeriksanya.
- Perubahan hanya boleh berada dalam scope Task ID. Jangan melakukan refactor besar atau menambahkan fitur tambahan tanpa persetujuan.
- Setelah coding, jalankan tes yang relevan dan laporkan hasil sebenarnya. Jangan mengklaim tes lulus jika belum dijalankan.
- Satu Task ID dianggap selesai hanya jika deliverable, acceptance criteria, tes, dan dokumentasinya terpenuhi.
- Jika ditemukan keputusan yang belum terkunci, jangan menutupinya dengan asumsi. Tandai sebagai blocker dan lanjutkan hanya bagian lain yang tidak bergantung padanya.

## 1.4 Aturan teknis lintas modul

1. PostgreSQL minimal versi 13.
2. Zona waktu bisnis `Asia/Jakarta`; simpan timestamp menggunakan tipe yang mempertahankan informasi zona waktu sesuai blueprint.
3. JWT harus diverifikasi di backend. Identitas aktor (`created_by`, `voided_by`, dan sejenisnya) berasal dari claims JWT, bukan input bebas frontend.
4. RBAC wajib diperiksa di backend pada setiap endpoint terlindungi. Menyembunyikan tombol di UI bukan pengganti otorisasi backend.
5. Validasi dilakukan pada frontend, backend, dan database sesuai tanggung jawab masing-masing.
6. Mutasi transaksi menggunakan transaksi ACID, idempotency UUIDv4, audit, dan locking sesuai kontrak modul.
7. Data historis bersifat append-only. Koreksi transaksi dilakukan melalui mekanisme VOID/reversal yang telah ditentukan, bukan `UPDATE` atau `DELETE` transaksi asli.
8. Stok adalah hasil perhitungan transaksi valid, bukan angka manual yang dapat diedit pengguna.
9. Perubahan harga katalog tidak mengubah snapshot harga pada transaksi penjualan lama.
10. Kegagalan cetak struk tidak boleh membatalkan transaksi penjualan yang sudah commit.

---

# 2. Ruang lingkup implementasi

## 2.1 Termasuk dalam MVP

### Fondasi aplikasi

- Login dan autentikasi JWT.
- Pemeriksaan status akun dan RBAC.
- Struktur aplikasi dan navigasi sesuai role.
- Koneksi database PostgreSQL 13+.
- Migrasi database, seeding master spesies, audit log, dan idempotency.

### Penerimaan ikan dan batch — V4.5

- Daftar penerimaan/batch.
- Form penerimaan ikan.
- Pembuatan satu batch otomatis untuk setiap penerimaan valid.
- Detail batch/penerimaan.
- VOID penerimaan sesuai aturan V4.5.
- Audit log.
- Penghitungan stok berdasarkan transaksi valid yang sudah termasuk dalam cakupan sistem.

### Ikan Keluar — Kasir/POS

- POS dengan satu batch untuk satu transaksi penjualan.
- Harga berdasarkan kombinasi spesies dan ukuran.
- Daftar harga yang dikelola Owner dan Admin Operasional.
- Pembayaran lunas Tunai atau Transfer.
- Daftar dan detail penjualan.
- VOID seluruh transaksi penjualan.
- Struk thermal 58 mm dan 80 mm.
- Cetak otomatis dan cetak ulang oleh pembuat transaksi sesuai aturan.

## 2.2 Tidak termasuk dalam MVP ini

Jangan menambahkan modul berikut pada rencana implementasi MVP tanpa persetujuan perubahan scope:

- Dashboard analitik atau laporan yang tidak ditentukan PRD.
- Laporan laba/rugi, profit per batch, dan akuntansi.
- Data pelanggan/CRM.
- Diskon, pajak, kupon, promosi, dan harga khusus.
- Pembayaran sebagian, cicilan, piutang, atau termin.
- Referensi transfer wajib.
- Penjualan berdasarkan kilogram atau satuan selain ekor.
- Satu struk untuk beberapa batch.
- VOID sebagian penjualan atau penghapusan transaksi historis.
- Modul pakan, stok pakan, kematian, kolam, pengadaan, dan biaya operasional.
- Integrasi perangkat/printer tertentu sebelum perangkat aktual dipilih dan diuji.
- UI/API pengelolaan master spesies; master spesies mengikuti mekanisme seeding V4.5.

**Catatan stok dan kematian:** rumus domain menyebut pengurangan kematian valid. Modul pencatatan kematian berada di luar MVP ini. Jangan membuat halaman, endpoint, atau tabel transaksi kematian atas inisiatif sendiri. Desain service perhitungan stok harus tetap dapat diperluas ketika modul kematian memiliki spesifikasi tersendiri. Jangan mengklaim pengurangan kematian telah aktif apabila sumber transaksi kematian belum tersedia.

---

# 3. Peta tahapan dan dependency

Urutan tingkat tinggi:

```text
Phase 0  Pemeriksaan repository dan kesiapan proyek
   |
   v
Phase 1  Penguncian fondasi teknis dan kontrak implementasi V4.5
   |
   v
Phase 2  Database, migration, seeding, constraint, privilege
   |
   v
Phase 3  Authentication dan RBAC V4.5
   |
   v
Phase 4  Backend Penerimaan, Batch, VOID, dan Audit
   |
   v
Phase 5  Frontend Penerimaan dan Batch
   |
   v
Phase 6  QA, security, performance, dan gerbang kelulusan V4.5
   |
   v
Gate POS  Selesaikan TBD dan setujui data model/API/printer
   |
   v
Phase 7  Database dan backend POS
   |
   v
Phase 8  Frontend POS, daftar harga, penjualan, VOID
   |
   v
Phase 9  Struk, printer, integrasi, dan QA POS
   |
   v
Phase 10 Release, deployment, backup, monitoring, dan handover
```

**Dependency wajib:** Phase 7–9 tidak boleh dimulai untuk implementasi final sebelum Gate POS dinyatakan lulus. Pekerjaan discovery atau proof-of-concept printer boleh dilakukan sebelumnya, tetapi tidak boleh menetapkan integrasi final tanpa keputusan perangkat.

---

# 4. Phase 0 — Pemeriksaan repository dan kesiapan proyek

**Tujuan:** mengetahui kondisi awal yang sebenarnya sebelum AI membuat atau mengubah file. Phase ini tidak boleh mengasumsikan aplikasi benar-benar kosong.

## Task P0-01 — Audit repository awal

**Tujuan:** memetakan apa yang sudah ada dan apa yang belum tersedia.

**Pekerjaan:**

- Periksa struktur folder dan file.
- Identifikasi frontend, backend, database layer, migration, test framework, dan konfigurasi build yang benar-benar ada.
- Periksa apakah sudah ada skema database, tabel, endpoint, autentikasi, RBAC, UI, dan test.
- Catat file penting dan titik masuk aplikasi.
- Jalankan pemeriksaan awal yang aman: status dependency, lint, build, dan tes yang tersedia. Jangan mengubah kode.
- Catat konflik antara kode saat ini dengan PRD/Master Blueprint.

**Deliverable:** `repository_audit.md` atau laporan audit setara yang berisi fakta `EXISTS`, `MISSING`, `PARTIAL`, dan `CONFLICT`.

**Acceptance criteria:**

- Tidak ada klaim stack atau fitur tanpa bukti dari repository.
- Semua temuan penting memiliki path file atau perintah pemeriksaan.
- Tidak ada file aplikasi yang diubah pada tugas audit ini.

## Task P0-02 — Kunci pilihan tunggal dari kandidat stack yang disetujui

**Tujuan:** mencatat pilihan stack yang telah disetujui pemilik produk melalui ADR 0001 dan menyelesaikan keputusan teknis yang masih terbuka.

**Keputusan yang telah dikunci pada ADR 0001:**

- npm workspaces monorepo: `apps/api`, `apps/web`, `packages/shared`.
- NestJS + TypeScript, Next.js App Router, Prisma + PostgreSQL/raw SQL berparameter.
- Zod + class-validator, Tailwind CSS + shadcn/ui, Jest + Supertest.
- Provisioning awal `Owner` lokal melalui CLI dari `.env`; tidak ada registrasi publik dan akun yang sudah ada tidak diubah.
- Pagination/filter dasar: `page=1`, `limit=20` (maksimum 100), timestamp ISO 8601 `startDate`/`endDate`, status enum resmi, default urutan `DESC`.

**Masih terbuka:** format dokumentasi API, target deployment, lifecycle administrasi akun selain provisioning awal, serta keputusan POS yang tetap berada di Gate POS.

**Yang sudah ditetapkan dan tidak perlu dipilih ulang:** PostgreSQL 13+, JWT, RBAC, ACID, idempotency UUIDv4, `Asia/Jakarta`, gaya arsitektur Decoupled REST API, serta ekosistem runtime Node.js + TypeScript (`APPROVED — OWNER`).

**Deliverable:** ADR 0001 dan konfigurasi workspace yang sesuai. Pilihan stack tidak boleh disimpulkan dari preferensi AI.

**Acceptance criteria:**

- Setiap pilihan memiliki alasan, dampak, dan status persetujuan.
- Tidak ada asumsi bahwa teknologi tertentu telah disetujui sebelum pemilik proyek mengesahkannya.

## Task P0-03 — Siapkan workflow pengembangan

**Tujuan:** membuat pengembangan dapat diulang dan diverifikasi.

**Pekerjaan:**

- Tetapkan struktur branch dan aturan pull request/review.
- Siapkan environment lokal dan staging sesuai keputusan stack.
- Pisahkan konfigurasi development, test, staging, dan production.
- Siapkan `.env.example` tanpa secret asli.
- Pastikan secret tidak masuk repository.
- Siapkan perintah standar untuk install, run, lint, test, build, migration, dan seed.

**Deliverable:** dokumentasi setup developer dan konfigurasi dasar proyek.

**Acceptance criteria:** developer lain dapat menyiapkan environment dari dokumentasi tanpa membocorkan secret.

---

# 5. Phase 1 — Penguncian desain teknis V4.5

**Tujuan:** mengubah kontrak V4.5 yang sudah disetujui menjadi desain implementasi yang konsisten dengan repository.

## Task P1-01 — Pemetaan domain dan requirement ke modul

**Pekerjaan:**

- Petakan `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, dan `audit_logs`.
- Petakan hubungan satu penerimaan dengan satu batch.
- Petakan status batch `active`, `completed`, dan `voided`.
- Petakan rumus stok dan transaksi yang dihitung.
- Buat matriks requirement → API → tabel → halaman → test.

**Deliverable:** domain map dan requirement traceability matrix.

**Acceptance criteria:** tidak ada requirement V4.5 tanpa lokasi implementasi dan cara pengujiannya.

## Task P1-02 — Review dan lengkapi kontrak API V4.5

**Pekerjaan:**

- Petakan endpoint mutasi penerimaan (`POST /api/v1/fish-entries`) dan VOID (`POST /api/v1/fish-entries/{batch_id}/void`) yang sudah dikunci.
- Dokumentasikan skema request/response, parameter query, dan error code untuk endpoint autentikasi dan pembacaan data V4.5 yang belum dirinci di blueprint (`POST /api/v1/auth/login`, `GET /api/v1/fish-species`, `GET /api/v1/batches`, `GET /api/v1/batches/{id}`, dan `GET /api/v1/audit-logs`).
- Konfirmasi header Authorization, `Idempotency-Key` UUIDv4, dan `Content-Type`.
- Konfirmasi request/response, validasi, dan error code sesuai blueprint.
- Tentukan format dokumentasi API berdasarkan stack yang disetujui.
- Jangan mengubah endpoint atau payload mutasi V4.5 yang telah dikunci tanpa persetujuan.

**Deliverable:** spesifikasi API V4.5 lengkap (mutasi & baca) yang siap digunakan frontend dan QA.

**Acceptance criteria:** request, response, status HTTP, error code, autentikasi, dan idempotency memiliki definisi yang dapat diuji.

## Task P1-03 — Rencana migrasi dan perlindungan data

**Pekerjaan:**

- Ubah data dictionary V4.5 menjadi urutan migration yang dapat diulang.
- Tetapkan constraint, unique index, foreign key, trigger, dan granular runtime privileges sesuai blueprint.
- Pastikan tabel transaksi historis dan audit bersifat append-only.
- Tentukan strategi rollback migration. Rollback struktur database tidak boleh menghapus data produksi secara tidak sengaja.
- Tetapkan strategi seeding master spesies sesuai daftar resmi.

**Deliverable:** migration plan dan checklist integritas database.

**Acceptance criteria:** desain migration mempertahankan semua aturan V4.5 dan dapat diuji pada PostgreSQL 13+ bersih.

---

# 6. Phase 2 — Database foundation V4.5

**Tujuan:** membangun lapisan persistensi yang menjadi sumber kebenaran transaksi.

## Task P2-01 — Siapkan database dan migration framework

**Pekerjaan:**

- Siapkan database development dan test PostgreSQL 13+.
- Konfigurasikan koneksi backend menggunakan secret dari environment.
- Pasang migration framework sesuai keputusan stack.
- Buat migration pertama untuk baseline schema.

**Deliverable:** database dapat dibuat dari keadaan kosong melalui perintah migration yang terdokumentasi.

**Acceptance criteria:** aplikasi terhubung ke database lokal/test; koneksi gagal ditangani dengan aman; secret tidak di-hardcode.

## Task P2-02 — Buat tabel master dan pengguna V4.5

**Pekerjaan:**

- Implementasikan struktur `users` sesuai data dictionary.
- Implementasikan `fish_species`.
- Terapkan normalisasi email dan unique index sesuai blueprint.
- Buat mekanisme seeding spesies aktif dan nonaktif sesuai master data yang disetujui.
- Jangan membuat UI pengelolaan master spesies.

**Deliverable:** migration dan seed untuk master/user.

**Acceptance criteria:** data master dapat di-seed berulang tanpa duplikasi; spesies nonaktif tidak dapat dipakai untuk penerimaan baru.

## Task P2-03 — Buat tabel batch dan penerimaan

**Pekerjaan:**

- Implementasikan `batch_daily_sequences`.
- Implementasikan `batches`.
- Implementasikan `incoming_fish` dan `incoming_fish_voids`.
- Terapkan hubungan satu batch : satu penerimaan.
- Terapkan enum ukuran dan batas field persis sesuai V4.5.
- Terapkan kode batch berbasis `entry_date`.

**Deliverable:** migration tabel penerimaan/batch beserta constraint.

**Acceptance criteria:** database menolak batch yang tidak memiliki tepat satu penerimaan; batas quantity, modal, sampel berat, ukuran, dan tanggal sesuai blueprint.

## Task P2-04 — Buat idempotency dan audit log

**Pekerjaan:**

- Implementasikan `idempotency_keys` sesuai aturan unique scope user + endpoint + key.
- Implementasikan penyimpanan hash payload yang dinormalisasi.
- Implementasikan `audit_logs` append-only.
- Terapkan privilege runtime yang melarang `UPDATE`/`DELETE` pada tabel yang immutable.
- Pastikan operasi bisnis dan audit dapat berada pada satu transaksi database.

**Deliverable:** tabel idempotency/audit, constraint, trigger, privilege, dan tes database.

**Acceptance criteria:** retry identik dapat mengembalikan respons cached; payload berbeda dengan key sama ditolak; kegagalan audit menyebabkan rollback transaksi bisnis.

## Task P2-05 — Uji constraint, trigger, dan sequence database

**Pekerjaan:**

- Uji unique constraint, foreign key, check constraint, deferred constraint trigger, dan status guard.
- Uji inisialisasi sequence saat tanggal baru.
- Uji sequence batch yang mencapai batas 999 dan respons yang ditentukan V4.5.
- Uji lock timeout dan rollback.
- Uji larangan perubahan data historis melalui runtime database role.

**Deliverable:** hasil tes database otomatis.

**Acceptance criteria:** seluruh aturan integritas V4.5 yang dapat ditegakkan di database terbukti lewat tes.

---

# 7. Phase 3 — Authentication dan RBAC V4.5

**Tujuan:** mengamankan aplikasi dan memastikan setiap role hanya dapat menjalankan operasi yang diizinkan.

## Task P3-01 — Implementasikan login JWT

**Pekerjaan:**

- Implementasikan autentikasi menggunakan JWT terverifikasi.
- Verifikasi status akun aktif.
- Ambil identitas user dan role dari claims/token yang telah diverifikasi.
- Jangan menerima `user_id`, `created_by`, atau aktor lain sebagai sumber otoritatif dari payload frontend.
- Tangani token hilang, tidak valid, kedaluwarsa, dan akun nonaktif.

**Deliverable:** endpoint/service login dan middleware autentikasi.

**Acceptance criteria:** kredensial salah atau akun nonaktif ditolak; setiap endpoint terlindungi dapat mengenali identitas user yang sah.

## Task P3-02 — Implementasikan RBAC backend

**Pekerjaan:**

- Terapkan satu role per pengguna untuk MVP.
- Implementasikan role V4.5: `Owner`, `Admin Operasional`, dan `Kepala Budidaya`.
- Terapkan hak akses per endpoint sesuai matriks V4.5.
- Uji akses positif dan negatif di backend, bukan hanya UI.

**Deliverable:** middleware/policy RBAC dan test matrix.

**Acceptance criteria:**

- **Owner-approved update (2026-11-17):** Owner dapat membuat dan melakukan VOID penerimaan.
- Admin Operasional dapat membuat dan melakukan VOID penerimaan sesuai aturan.
- Kepala Budidaya dapat membuat penerimaan tetapi tidak dapat melakukan VOID penerimaan.
- Akses data/fitur lain mengikuti matriks V4.5.

## Task P3-03 — Tetapkan provisioning akun awal

**Pekerjaan:**

- Gunakan keputusan pada Task P0-02 tentang pembuatan akun awal.
- Dokumentasikan proses membuat akun uji dan akun operasional pertama.
- Jangan membuat halaman administrasi pengguna, registrasi publik, atau reset kata sandi tanpa keputusan produk.

**Deliverable:** prosedur provisioning akun yang disetujui.

**Acceptance criteria:** tim dapat membuat akun yang dibutuhkan untuk pengujian dan operasional tanpa menambah fitur akun yang belum disetujui.

---

# 8. Phase 4 — Backend Penerimaan, Batch, VOID, dan Audit

**Tujuan:** menyelesaikan seluruh API domain V4.5 sebelum integrasi frontend.

## Task P4-01 — Implementasikan API pembuatan penerimaan

**Requirement utama:** FR-REC-01 sampai FR-REC-04, FR-REC-06, FR-BATCH-01.

**Pekerjaan:**

- Implementasikan `POST /api/v1/fish-entries` sesuai kontrak V4.5.
- Validasi JWT, role, payload, tanggal `Asia/Jakarta`, spesies aktif, enum ukuran, dan batas numerik.
- Buat batch dan penerimaan secara atomik.
- Alokasikan nomor batch secara aman dari concurrent requests.
- Tulis audit log dan finalize idempotency dalam transaksi yang sama.
- Pastikan respons retry identik berasal dari hasil cached.

**Deliverable:** endpoint penerimaan, service/domain logic, dan integration tests.

**Acceptance criteria:** satu penerimaan valid membuat satu batch dan satu record penerimaan; kegagalan pada salah satu langkah tidak meninggalkan transaksi parsial.

## Task P4-02 — Implementasikan API daftar dan detail batch/penerimaan

**Requirement utama:** FR-REC-05.

**Pekerjaan:**

- Buat endpoint daftar penerimaan/batch sesuai hak akses.
- Buat endpoint detail batch/penerimaan.
- Sajikan status batch dan stok hasil kalkulasi, bukan input stok manual.
- Terapkan hanya filter, sort, pencarian, dan pagination yang sudah disetujui. Bila belum diputuskan, jangan mengarang opsi filter tambahan.

**Deliverable:** API daftar dan detail.

**Acceptance criteria:** data yang ditampilkan sesuai database dan role; stok tidak dapat dimutasi melalui endpoint baca.

## Task P4-03 — Implementasikan API VOID penerimaan

**Requirement utama:** FR-REC-07 sampai FR-REC-09.

**Pekerjaan:**

- Implementasikan endpoint VOID sesuai kontrak V4.5.
- Owner dan Admin Operasional dapat melakukan VOID penerimaan.
- Alasan VOID wajib.
- Tolak VOID jika ada transaksi turunan.
- Lock batch dengan `SELECT ... FOR UPDATE` dan validasi status sebelum mutasi.
- Tulis record reversal dan audit; jangan mengubah/menghapus penerimaan asli.
- Terapkan idempotency dan rollback atomik.

**Deliverable:** endpoint VOID dan integration tests.

**Acceptance criteria:** alasan kosong ditolak; transaksi turunan menghalangi VOID; request bersamaan tidak menghasilkan status inkonsisten.

## Task P4-04 — Implementasikan API Audit Log

**Requirement utama:** FR-AUD-01.

**Pekerjaan:**

- Implementasikan query baca audit log.
- Terapkan akses sesuai matriks V4.5: Owner, Admin Operasional, dan Kepala Budidaya.
- Tampilkan identitas pelaku, tindakan, waktu, serta referensi objek yang tersedia dalam kontrak.
- Tidak menyediakan edit atau hapus audit log.

**Deliverable:** API baca audit log dan tes RBAC.

**Acceptance criteria:** seluruh tindakan yang diwajibkan tercatat; hanya role berwenang dapat membaca; data audit tidak dapat diubah.

---

# 9. Phase 5 — Frontend Penerimaan dan Batch

**Tujuan:** menyelesaikan halaman produk sesuai PG-01 sampai PG-06 pada PRD.

## Task P5-01 — Buat fondasi UI dan navigasi berdasarkan role

**Pekerjaan:**

- Buat application shell, layout responsif, komponen form, tabel, dialog konfirmasi, dan komponen pesan error.
- Buat routing halaman berdasarkan autentikasi dan role.
- Menu yang tidak berhak diakses tidak ditampilkan, tetapi backend tetap menjadi otoritas akses.
- Jangan membuat dashboard analitik atau menu di luar peta halaman PRD.

**Deliverable:** kerangka aplikasi dan navigasi awal.

**Acceptance criteria:** tampilan dapat digunakan pada ukuran layar target yang dipilih; menu mengikuti matriks role.

## Task P5-02 — Buat halaman Login (PG-01)

**Pekerjaan:**

- Input email dan kata sandi.
- Integrasi ke API autentikasi.
- Tangani kredensial salah, akun nonaktif, token kedaluwarsa, dan server tidak tersedia.
- Jangan menampilkan detail sensitif dalam pesan error.

**Deliverable:** halaman login terintegrasi.

**Acceptance criteria:** login sukses membawa user ke area sesuai role; kegagalan tidak menciptakan sesi palsu.

## Task P5-03 — Buat daftar Penerimaan/Batch (PG-02)

**Pekerjaan:**

- Tampilkan informasi minimum sesuai PRD.
- Tampilkan status batch dan stok terhitung.
- Integrasikan API daftar.
- Tangani loading, empty state, error, dan retry.

**Deliverable:** halaman daftar penerimaan/batch.

**Acceptance criteria:** data, status, dan stok sama dengan hasil API; role yang tidak berhak ditolak.

## Task P5-04 — Buat Form Penerimaan Ikan (PG-03)

**Pekerjaan:**

- Buat field dan validasi sesuai V4.5.
- Tampilkan daftar spesies aktif dan ukuran resmi.
- Jangan mengisi nilai modal default `0.00` secara otomatis.
- Terapkan batas input quantity, modal, dan sampel berat.
- Gunakan `Idempotency-Key` UUIDv4 ketika submit.
- Cegah double-submit dari sisi UX; proteksi utama tetap di backend.

**Deliverable:** form penerimaan terintegrasi.

**Acceptance criteria:** data valid dapat disimpan; field invalid menampilkan pesan yang jelas; hasil sukses menampilkan batch yang terbentuk.

## Task P5-05 — Buat Detail Batch dan VOID Penerimaan (PG-04/PG-05)

**Pekerjaan:**

- Tampilkan detail penerimaan/batch.
- Tampilkan aksi sesuai role dan status.
- Form alasan VOID wajib.
- Minta konfirmasi sebelum VOID.
- Tampilkan error saat batch tidak aktif atau memiliki transaksi turunan.

**Deliverable:** halaman detail dan alur VOID penerimaan.

**Acceptance criteria:** aksi UI tidak melampaui hak backend; VOID sukses memperlihatkan status terbaru; penerimaan asli tetap dapat ditelusuri.

## Task P5-06 — Buat halaman Audit Log (PG-06)

**Pekerjaan:**

- Tampilkan data audit minimum yang disediakan API.
- Terapkan akses Owner, Admin Operasional, dan Kepala Budidaya.
- Tidak menyediakan aksi edit/hapus.

**Deliverable:** halaman audit log.

**Acceptance criteria:** user tanpa izin tidak dapat membuka halaman atau API audit.

---

# 10. Phase 6 — QA dan Gerbang kelulusan V4.5

**Tujuan:** memastikan modul Penerimaan dan VOID memenuhi kontrak sebelum POS memperbesar cakupan risiko.

## Task P6-01 — Unit test domain dan validator

**Pekerjaan:**

- Uji batas input dan normalisasi payload.
- Uji aturan tanggal `Asia/Jakarta`.
- Uji penghitungan status batch dan stok.
- Uji pemetaan role ke operasi.

**Deliverable:** unit tests untuk domain service dan validator.

**Acceptance criteria:** seluruh aturan penting memiliki tes deterministik.

## Task P6-02 — Integration test database dan API

**Pekerjaan:**

- Uji penerimaan lengkap dan invalid.
- Uji idempotency retry dan idempotency mismatch.
- Uji sequence dan concurrency.
- Uji atomic rollback jika insert atau audit gagal.
- Uji immutable table dan privilege runtime.
- Uji VOID dengan dan tanpa transaksi turunan.
- Uji lock timeout dan status guard.

**Deliverable:** integration test yang berjalan pada PostgreSQL test.

**Acceptance criteria:** tidak ada transaksi parsial, duplikasi, atau stok/status inkonsisten.

## Task P6-03 — Jalankan 32 Test Cases V4.5

**Pekerjaan:**

- Jalankan TC-01 sampai TC-32 dari Master Blueprint.
- Catat hasil `PASS`, `FAIL`, atau `BLOCKED` beserta bukti log.
- Perbaiki kegagalan dalam Task ID terpisah.
- Jalankan ulang seluruh suite setelah perbaikan.

**Deliverable:** laporan QA V4.5.

**Acceptance criteria:** 32/32 test case lulus; tidak boleh melaporkan selesai jika ada test `FAIL` atau `BLOCKED`.

## Task P6-04 — Uji performance dan security V4.5

**Pekerjaan:**

- Siapkan staging sesuai spesifikasi minimum blueprint: 2 vCPU, 4 GB RAM, database berisi minimal 100.000 record.
- Jalankan 50 concurrent requests untuk penyimpanan penerimaan.
- Ukur p95 response time dan bandingkan dengan target maksimal 1,5 detik.
- Review autentikasi, RBAC, granular database privileges, secret handling, audit, dan input validation.

**Deliverable:** performance report dan security checklist.

**Acceptance criteria:** target NFR penyimpanan penerimaan tercapai; seluruh temuan keamanan kritis ditutup atau memiliki keputusan tertulis sebelum release.

## Gate V4.5 — Persetujuan sebelum POS

Gate dinyatakan lulus hanya jika:

- [ ] Seluruh 32 test case V4.5 lulus.
- [ ] Regression test tidak menemukan kerusakan fungsi.
- [ ] Migration dan seed berhasil pada database PostgreSQL 13+ yang bersih.
- [ ] RBAC backend dan database privilege sudah diuji.
- [ ] Audit log dan idempotency terbukti atomik.
- [ ] Backup/restore test dasar berhasil pada staging.
- [ ] Owner menyetujui hasil V4.5 untuk menjadi baseline POS.

---

# 11. Gate POS — Penutupan keputusan sebelum coding

**Tujuan:** memastikan seluruh rancangan teknis POS telah berubah dari `PROPOSED — TECHNICAL` menjadi kontrak yang disetujui. Keputusan bisnis POS yang telah dikunci tetap harus dipertahankan.

## Task GPOS-01 — Verifikasi keputusan owner & selesaikan sisa TBD POS

| TBD    | Status Terkini                                            | Keputusan / Sisa tindakan yang dibutuhkan                                                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TBD-01 | `APPROVED — OWNER`                                        | Ditetapkan batas harga Rp 1 s.d. Rp 10.000.000 per ekor (`BIGINT`, Rupiah bulat tanpa desimal).                                                                                                                                                                                                      |
| TBD-02 | `APPROVED — OWNER`                                        | Audit perubahan harga (`action = 'UPDATE_PRICE'`) hanya mencatat aktor dan waktu (`old_values = NULL`, `new_values = NULL`).                                                                                                                                                                         |
| TBD-03 | `TBD — NEEDS DECISION`                                    | Pendekatan ESC/POS Bluetooth (mobile) & Web USB/Browser Print (PC/laptop) disetujui, namun merek/model printer, solusi bridge Bluetooth iOS/iPhone, dan uji perangkat aktual tetap wajib diselesaikan di `GPOS-04`.                                                                                  |
| TBD-04 | `TBD — NEEDS DECISION`                                    | Request/response body, error code (termasuk rollback konkurensi/harga berubah dan kewajiban `Idempotency-Key` baru), serta strategi refresh dan konfirmasi harga API POS wajib dikunci di `GPOS-03`. Pagination/filter dasar mengikuti ADR 0001, tetapi envelope final POS tetap bagian kontrak API. |
| TBD-05 | `APPROVED — OWNER`                                        | Menggunakan tabel `sale_daily_sequences` (`sale_date DATE PRIMARY KEY`, `last_number BIGINT`) tanpa batas 999.                                                                                                                                                                                       |
| TBD-06 | `APPROVED — OWNER` _(Actions)_ / `TBD` _(DDL/Privileges)_ | Nilai `action` (`CREATE_SALE`, `VOID_SALE`, `UPDATE_PRICE`) disetujui; `ALTER CONSTRAINT` DDL, trigger imutabilitas, index, dan `GRANT`/`REVOKE` runtime POS dikunci di `GPOS-02`.                                                                                                                   |
| TBD-07 | `APPROVED — OWNER`                                        | Role `Kasir` dilarang (`Forbidden`) mengakses data maupun halaman Audit Log.                                                                                                                                                                                                                         |
| TBD-08 | `PARTIALLY RESOLVED — OWNER` (ADR 0001)                   | Provisioning awal `Owner` lokal melalui CLI idempoten dari `.env` telah disetujui. Deaktivasi akun, perubahan role, reset kata sandi, dan administrasi pengguna tetap TBD.                                                                                                                           |
| TBD-09 | `APPROVED — OWNER` (ADR 0001)                             | Default `page=1`, `limit=20`, maksimum `100`; rentang tanggal ISO 8601 pada timestamp utama, status hanya enum resmi, urutan default `DESC`. Pencarian dan pilihan sort tambahan belum disetujui.                                                                                                    |

**Deliverable:** daftar keputusan yang seluruh barisnya memiliki status `APPROVED`, `REJECTED`, atau `DEFERRED` dengan dampak yang jelas. Baris yang memblokir desain tidak boleh dibiarkan kosong.

## Task GPOS-02 — Finalisasi data model POS

**Pekerjaan:**

- Review rancangan konseptual `fish_sale_prices`, `fish_sales`, `fish_sale_voids`, dan sequence penjualan.
- Konfirmasi apakah rancangan tabel perlu diselaraskan dengan skema nyata V4.5.
- Konfirmasi unique constraints, foreign keys, indexes, check constraints, trigger, dan privilege runtime.
- Pastikan penjualan mengikat tepat satu batch.
- Pastikan snapshot harga dan total tersimpan pada transaksi.
- Pastikan transaksi penjualan serta VOID bersifat append-only.
- Pastikan VOID satu kali per transaksi dan mengembalikan stok.

**Deliverable:** database design POS yang disetujui.

## Task GPOS-03 — Finalisasi API Contract POS

**Pekerjaan:**

- Finalisasi endpoint harga, POS batch list, create sale, sale list/detail, void sale, dan receipt retrieval sesuai cakupan PRD.
- Finalisasi payload, response, validasi, error code, pagination (jika disetujui), dan idempotency.
- Tentukan perilaku perubahan harga ketika kasir sedang menyelesaikan transaksi.
- Pastikan `created_by` ditentukan dari JWT.

**Deliverable:** API Contract POS final dan dapat diturunkan menjadi test case.

## Task GPOS-04 — Proof-of-concept printer dan persetujuan desain UI POS

**Pekerjaan:**

- Inventarisasi perangkat kasir aktual dan printer yang tersedia.
- Uji pairing dan kemampuan cetak dari perangkat aktual.
- Pastikan strategi mendukung layout 58 mm dan 80 mm.
- Putuskan apakah integrasi dilakukan melalui browser, aplikasi wrapper, atau pendekatan lain berdasarkan hasil uji dan stack yang telah dipilih.
- Review desain halaman POS, daftar harga, daftar penjualan, detail penjualan, dialog VOID, dan cetak.

**Deliverable:** hasil uji printer, keputusan integrasi, dan desain UI yang disetujui.

## Gate POS — Acceptance criteria

- [ ] Seluruh keputusan bisnis POS sesuai PRD.
- [ ] TBD pemblokir database, API, audit, dan printer sudah diselesaikan.
- [ ] Data model POS disetujui.
- [ ] API Contract POS disetujui.
- [ ] Desain halaman dan user flow disetujui.
- [ ] Test case POS bernomor beserta expected result tersedia.
- [ ] Printer aktual telah diuji, atau implementasi printing ditahan sebagai pekerjaan terpisah yang jelas.
- [ ] Seluruh regression test V4.5 tetap lulus.

---

# 12. Phase 7 — Database dan backend POS

**Prasyarat:** Gate POS lulus. Semua nama tabel, tipe data, endpoint, dan payload pada fase ini wajib mengikuti dokumen POS yang telah disetujui, bukan sekadar nama usulan di PRD.

## Task P7-01 — Perluas role dan RBAC untuk Kasir

**Pekerjaan:**

- Tambahkan role `Kasir` melalui migration yang aman.
- Pertahankan tiga role dan privilege V4.5.
- Implementasikan akses POS untuk Owner, Admin Operasional, dan Kasir.
- Batasi pengelolaan harga hanya untuk Owner dan Admin Operasional.
- Tetap larang Kepala Budidaya mengakses POS.
- Terapkan kebijakan Audit Log untuk Kasir hanya sesuai keputusan TBD-07.

**Deliverable:** migration role dan tes RBAC empat role.

**Acceptance criteria:** akses seluruh endpoint cocok dengan matriks PRD; tidak ada privilege tambahan secara tidak sengaja.

## Task P7-02 — Implementasikan database daftar harga

**Pekerjaan:**

- Implementasikan penyimpanan harga berdasarkan `species_id + fish_size`.
- Terapkan satu harga aktif untuk satu kombinasi spesies dan ukuran.
- Harga berupa integer Rupiah, tanpa pecahan.
- Terapkan batas nominal yang telah disetujui pada TBD-01.
- Owner/Admin dapat menambah dan mengubah harga; Kasir hanya membaca harga; tidak ada operasi hapus.
- Pastikan perubahan daftar harga tidak mengubah snapshot penjualan lama.

**Deliverable:** migration, constraint, service, dan tes daftar harga.

**Acceptance criteria:** harga tanpa nilai valid tidak dapat dipakai untuk penjualan; tidak ada perubahan pada transaksi historis.

## Task P7-03 — Implementasikan database penjualan dan sequence

**Pekerjaan:**

- Implementasikan tabel penjualan dan record VOID sesuai data model yang disetujui.
- Implementasikan sequence nomor penjualan `PFI-SAL-YYYYMMDD-XXX`.
- Sequence harian harus unik, atomik, dan dapat melewati 999.
- Simpan batch, quantity, snapshot harga per ekor, total, metode pembayaran, dan informasi pembayaran tunai sesuai kontrak.
- Simpan aktor/waktu transaksi dan VOID.
- Jangan menyimpan data pelanggan, nomor referensi transfer, atau data tambahan di luar scope.

**Deliverable:** migration dan tes integritas penjualan.

**Acceptance criteria:** nomor tidak duplikat dalam request bersamaan; transaksi historis append-only.

## Task P7-04 — Implementasikan query stok dan daftar batch POS

**Pekerjaan:**

- Buat query batch yang hanya menampilkan batch `active` dengan stok valid > 0.
- Hitung stok dari transaksi valid, bukan kolom stok manual yang bisa diedit.
- Siapkan mekanisme locking batch dan validasi ulang stok.
- Jangan mengizinkan stok negatif atau overselling.
- Pastikan status `completed` saat stok valid menjadi 0 dan dapat kembali `active` setelah VOID penjualan jika stok valid kembali > 0, selama batch tidak `voided`.

**Deliverable:** stock query/service dan concurrency tests.

**Acceptance criteria:** dua kasir yang menjual batch sama secara bersamaan tidak dapat membuat stok negatif.

## Task P7-05 — Implementasikan API pembuatan penjualan

**Pekerjaan:**

- Validasi JWT, role POS, request schema, idempotency UUIDv4, status batch, stok, harga, quantity, dan pembayaran.
- Jika quantity melebihi stok saat ini, backend mengembalikan kondisi yang memungkinkan UI menampilkan quantity yang dibatasi dan meminta konfirmasi; keputusan akhir tetap harus tervalidasi lagi sebelum commit.
- Refresh dan validasi harga sebelum transaksi disimpan.
- Untuk Tunai, uang diterima harus minimal sebesar total dan kembalian dihitung sistem.
- Untuk Transfer, kasir harus mengonfirmasi pembayaran telah diterima.
- Lock batch, hitung ulang stok, simpan snapshot harga, alokasikan sequence, simpan penjualan, catat audit, dan finalize idempotency dalam satu transaksi ACID.
- Commit transaksi lebih dahulu sebelum proses cetak dimulai.

**Deliverable:** API create sale dan integration/concurrency tests.

**Acceptance criteria:** tidak ada penjualan tanpa harga; pembayaran harus lunas; retry tidak menggandakan transaksi; kegagalan audit/database me-rollback transaksi.

## Task P7-06 — Implementasikan API daftar/detail/VOID penjualan

**Pekerjaan:**

- Buat API daftar dan detail penjualan untuk seluruh role POS.
- Implementasikan VOID satu transaksi secara utuh, tanpa alasan wajib.
- Semua role POS dapat VOID transaksi yang belum pernah di-VOID.
- VOID menambah record reversal, bukan mengubah transaksi asli.
- Lock batch dan pulihkan stok dalam satu transaksi ACID.
- Transaksi VOID tidak dapat di-VOID lagi dan tidak dapat dicetak ulang.

**Deliverable:** API sales list/detail/void dan integration tests.

**Acceptance criteria:** histori asli tetap tersedia; VOID memulihkan stok tepat satu kali; akses dan status mengikuti PRD.

## Task P7-07 — Implementasikan data struk dan otorisasi cetak ulang

**Pekerjaan:**

- Sediakan data struk sesuai konten wajib PRD.
- Nomor penjualan internal dan kode batch tidak boleh dicetak.
- Hanya pembuat transaksi yang boleh meminta cetak ulang.
- Transaksi VOID tidak dapat dicetak ulang.
- Mengambil data struk atau mengulang cetak tidak boleh membuat transaksi baru.

**Deliverable:** receipt data endpoint/service dan tes authorization.

**Acceptance criteria:** konten struk tepat; user lain dan transaksi VOID ditolak untuk cetak ulang.

---

# 13. Phase 8 — Frontend POS

**Prasyarat:** API Contract POS dan API backend terkait sudah stabil pada environment test.

## Task P8-01 — Buat halaman POS/Kasir (PG-07)

**Pekerjaan:**

- Tampilkan hanya batch aktif dengan stok > 0.
- Pilih satu batch untuk satu transaksi.
- Input quantity menggunakan satuan ekor.
- Ketika quantity melebihi stok, tampilkan nilai quantity hasil pembatasan dan minta konfirmasi eksplisit.
- Tampilkan harga terbaru, refresh, dan minta konfirmasi harga sebelum menyimpan.
- Sediakan pilihan Tunai atau Transfer.
- Untuk Tunai, input uang diterima dan tampilkan total/kembalian.
- Untuk Transfer, minta konfirmasi bahwa dana sudah diterima.
- Tampilkan status loading dan cegah interaksi ganda selama request.

**Deliverable:** alur POS terintegrasi end-to-end.

**Acceptance criteria:** semua aturan pembayaran, harga, stok, dan satu batch per transaksi dipatuhi UI dan backend.

## Task P8-02 — Buat halaman Daftar Harga (PG-08)

**Pekerjaan:**

- Tampilkan harga per spesies dan ukuran.
- Owner/Admin dapat menambah serta mengubah harga.
- Kasir tidak mendapatkan kontrol ubah harga.
- Tidak tersedia tombol hapus harga.
- Tampilkan validasi sesuai batas harga yang telah disetujui.

**Deliverable:** halaman daftar harga dan form tambah/edit.

**Acceptance criteria:** UI selaras dengan RBAC backend; perubahan katalog tidak memengaruhi histori transaksi.

## Task P8-03 — Buat halaman Daftar Penjualan (PG-09)

**Pekerjaan:**

- Semua role POS dapat melihat seluruh penjualan.
- Tampilkan data minimum pada PRD: nomor internal, waktu, batch internal, spesies/ukuran, quantity, harga, total, metode pembayaran, pembuat, dan status.
- Terapkan pencarian/filter/pagination hanya jika telah disetujui pada TBD-09.

**Deliverable:** halaman daftar penjualan.

**Acceptance criteria:** histori transaksi dan status VOID dapat ditelusuri; transaksi tidak dapat diedit atau dihapus.

## Task P8-04 — Buat Detail Penjualan dan alur VOID (PG-10)

**Pekerjaan:**

- Tampilkan informasi detail penjualan.
- Sediakan aksi VOID bagi role POS untuk transaksi yang belum VOID.
- Minta konfirmasi sebelum VOID; jangan meminta alasan wajib.
- Tampilkan status dan stok terbaru setelah VOID.
- Sediakan aksi cetak ulang hanya bagi pembuat transaksi dan jika belum VOID.

**Deliverable:** halaman detail dan dialog VOID.

**Acceptance criteria:** kontrol UI sesuai dengan keputusan bisnis; backend tetap memverifikasi hak dan status.

---

# 14. Phase 9 — Struk, printer, integrasi, dan QA POS

## Task P9-01 — Implementasikan layout struk 58 mm dan 80 mm

**Konten wajib dan hanya konten berikut:**

- Nama perusahaan Pisciculture Farm Indonesia.
- Tanggal dan waktu.
- Spesies ikan.
- Ukuran ikan.
- Jumlah (ekor).
- Harga per ekor.
- Total pembayaran.
- Metode pembayaran.
- Nama kasir.

**Larangan konten:** jangan cetak nomor penjualan, kode batch, informasi pelanggan, atau referensi transfer.

**Deliverable:** template struk 58 mm dan 80 mm.

**Acceptance criteria:** semua field wajib tampil terbaca pada kedua lebar; konten terlarang tidak tampil.

## Task P9-02 — Integrasikan auto-print dan reprint

**Pekerjaan:**

- Jalankan proses cetak setelah penjualan berhasil commit.
- Pisahkan status transaksi dari status printer.
- Jika printer tidak tersedia/gagal, tampilkan kegagalan cetak tanpa menyatakan transaksi gagal.
- Izinkan pembuat transaksi mencetak ulang transaksi aktif.
- Tolak cetak ulang oleh user lain atau untuk transaksi VOID.
- Retry cetak tidak boleh mengirim ulang create-sale.

**Deliverable:** workflow auto-print/reprint yang terpisah dari transaksi database.

**Acceptance criteria:** kegagalan printer tidak menghapus penjualan atau membuat duplikasi.

## Task P9-03 — Uji printer lintas perangkat yang disepakati

**Pekerjaan:**

- Uji pairing dan cetak pada perangkat aktual yang disepakati.
- Uji Android, iPhone, PC, atau laptop hanya sesuai kombinasi perangkat/printer yang benar-benar dipilih.
- Uji kertas 58 mm dan 80 mm.
- Catat metode koneksi, batasan, dan prosedur operasional.

**Deliverable:** printer compatibility matrix.

**Acceptance criteria:** seluruh kombinasi yang dinyatakan didukung telah diuji secara fisik; jangan mengklaim kompatibilitas universal Bluetooth.

## Task P9-04 — Jalankan QA POS

**Pekerjaan:**

- Uji price missing dan harga berubah sebelum commit.
- Uji batas quantity, stok berubah, batch completed, dan batch voided.
- Uji Tunai, kekurangan uang, uang pas, dan kembalian.
- Uji Transfer dan konfirmasi pembayaran.
- Uji idempotency retry serta payload mismatch.
- Uji dua kasir bersamaan terhadap satu batch.
- Uji sale VOID, stok pulih, status batch aktif kembali, dan pencegahan VOID kedua.
- Uji otorisasi role, cetak otomatis, reprint, printer gagal, dan penolakan reprint.
- Uji sequence penjualan melewati 999.
- Jalankan ulang seluruh 32 TC V4.5 sebagai regression.

**Deliverable:** test suite POS dan laporan QA lengkap.

**Acceptance criteria:** seluruh test case POS yang disetujui lulus; seluruh 32 test case V4.5 tetap lulus.

---

# 15. Phase 10 — Release dan go-live

**Tujuan:** memindahkan versi yang telah lulus QA ke lingkungan produksi secara aman dan dapat dipulihkan.

## Task P10-01 — Siapkan production environment

**Pekerjaan:**

- Siapkan host, database PostgreSQL, domain/TLS, network rules, dan runtime berdasarkan keputusan deployment.
- Pisahkan secret production dari repository.
- Batasi akses database dan panel administrasi.
- Aktifkan pencatatan log dan health check yang diperlukan.

**Deliverable:** production environment siap menerima release.

## Task P10-02 — Siapkan backup, restore, dan retensi data operasional

**Pekerjaan:**

- Tentukan jadwal backup dan retensi berdasarkan persetujuan operasional.
- Simpan backup di lokasi terpisah dari instance database utama.
- Uji restore ke environment terisolasi.
- Tetapkan prosedur pemeliharaan/pengarsipan berkala tabel `idempotency_keys` melalui role administratif terjadwal (karena `App Runtime Role` tidak memiliki hak `DELETE`) agar pertumbuhan baris tidak menurunkan performa query.
- Dokumentasikan langkah recovery dan siapa yang berwenang menjalankannya.

**Deliverable:** backup policy, prosedur restore, dan bukti uji restore.

**Acceptance criteria:** database dapat dipulihkan dari backup yang dibuat; akses backup dibatasi.

## Task P10-03 — Release candidate dan smoke test

**Pekerjaan:**

- Buat release candidate dari branch yang telah direview.
- Jalankan migration production secara terkontrol dan backup sebelum perubahan berisiko.
- Jalankan smoke test login, RBAC, penerimaan, daftar batch, VOID sesuai role, audit, POS, harga, penjualan, VOID penjualan, dan cetak.
- Pantau log error setelah release.

**Deliverable:** release checklist dan hasil smoke test.

**Acceptance criteria:** semua alur inti berjalan pada production tanpa error kritis.

## Task P10-04 — Handover operasional

**Pekerjaan:**

- Tulis panduan singkat untuk Owner, Admin Operasional, Kepala Budidaya, dan Kasir sesuai hak akses.
- Dokumentasikan prosedur bila penerimaan gagal, VOID ditolak, pembayaran berhasil tetapi printer gagal, atau koneksi database terputus.
- Dokumentasikan kontak/penanggung jawab teknis berdasarkan struktur PFI yang ditentukan pemilik proyek.

**Deliverable:** user guide, runbook, dan catatan handover.

**Acceptance criteria:** pengguna operasional dapat menjalankan fungsi sesuai role dan mengetahui langkah saat terjadi kegagalan.

---

# 16. Template sesi kerja AI

Gunakan template ini setiap kali memulai satu Task ID. Isi hanya satu Task ID per sesi.

```text
Kita sedang mengerjakan proyek PFI.

Dokumen sumber yang wajib dibaca:
1. prd.md
2. master_blueprint_api_contract_pfi_main.md
3. implementation_plan.md

Task ID: [ISI SATU TASK ID]

Instruksi:
1. Periksa repository dan kondisi kode aktual sebelum mengubah file.
2. Baca requirement dan acceptance criteria yang terkait dengan Task ID ini.
3. Identifikasi status keputusan: LOCKED, PROPOSED, TBD, atau OUT OF SCOPE.
4. Sebutkan rencana perubahan file dan cara pengujian sebelum coding.
5. Jangan mengerjakan Task ID lain.
6. Jangan menambah fitur atau mengubah keputusan bisnis di luar dokumen.
7. Jika ada konflik atau keputusan TBD yang memblokir, hentikan bagian terkait dan laporkan secara spesifik.
8. Implementasikan perubahan sekecil mungkin yang menyelesaikan Task ID ini.
9. Jalankan tes yang relevan dan laporkan perintah serta hasil aktual.
10. Perbarui dokumentasi teknis yang memang terdampak.

Format laporan akhir:
- Task ID dan status: DONE / BLOCKED / PARTIAL
- Requirement yang dipenuhi
- File yang dibuat/diubah
- Ringkasan perubahan
- Tes yang dijalankan dan hasil
- Acceptance criteria yang lulus/gagal
- Risiko atau blocker yang ditemukan
- Task ID berikutnya yang menjadi dependency

Jangan mengklaim DONE apabila acceptance criteria belum terbukti.
```

---

# 17. Definition of Ready dan Definition of Done

## 17.1 Definition of Ready (DoR)

Satu Task ID boleh dimulai jika:

- [ ] Tujuan dan batas scope Task ID jelas.
- [ ] Requirement ID dari PRD/Blueprint telah dicantumkan.
- [ ] Status keputusan sudah diketahui.
- [ ] Dependency sebelumnya selesai.
- [ ] Field, validasi, role, dan user flow terkait sudah didefinisikan.
- [ ] Dampak database dan API diketahui.
- [ ] Acceptance criteria dapat diverifikasi.
- [ ] Tidak ada TBD yang memblokir Task ID.
- [ ] Repository dan file yang akan diubah sudah diperiksa.

## 17.2 Definition of Done (DoD)

Satu Task ID dinyatakan selesai jika:

- [ ] Implementasi hanya mencakup scope yang disepakati.
- [ ] Tidak ada perubahan aturan bisnis tanpa persetujuan.
- [ ] Validasi dan otorisasi diterapkan pada lapisan yang tepat.
- [ ] Tes terkait sudah dijalankan dan hasilnya tercatat.
- [ ] Tidak ada regression yang diketahui.
- [ ] Dokumentasi yang terdampak telah diperbarui.
- [ ] Tidak ada secret atau data sensitif yang masuk repository/log.
- [ ] Hasil review diterima oleh pemilik proyek atau reviewer yang ditunjuk.

---

# 18. Daftar risiko dan mitigasi

| Risiko                                         | Dampak                                | Mitigasi/gerbang                                                                                     |
| ---------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Stack dipilih tanpa audit repository           | Rework dan konflik dependency         | P0-01 wajib sebelum keputusan stack dan coding.                                                      |
| AI mengarang keputusan TBD                     | Skema/API berubah berulang            | Gunakan Gate POS dan larangan asumsi.                                                                |
| Role hanya dibatasi pada frontend              | Akses ilegal melalui API              | RBAC backend dan privilege database wajib diuji.                                                     |
| Request diulang akibat jaringan                | Transaksi ganda                       | Idempotency UUIDv4 dan payload hash.                                                                 |
| Dua pengguna mengubah stok bersamaan           | Overselling/stok negatif              | Batch row locking dan validasi stok ulang dalam transaksi.                                           |
| Audit gagal tersimpan                          | Aksi bisnis tanpa jejak               | Audit berada dalam transaksi ACID yang sama.                                                         |
| Data penerimaan/penjualan diubah atau dihapus  | Histori tidak dapat dipercaya         | Append-only, reversal, trigger, dan runtime privileges.                                              |
| Perubahan daftar harga mengubah transaksi lama | Nilai transaksi historis berubah      | Snapshot harga pada saat penjualan.                                                                  |
| Printer gagal setelah transaksi tersimpan      | Kasir mengulang penjualan             | Pisahkan commit transaksi dari status proses cetak.                                                  |
| Printer tidak kompatibel dengan perangkat      | Cetak tidak berjalan saat operasional | Uji model/perangkat aktual sebelum integrasi final.                                                  |
| Modul kematian belum ada                       | Stok belum mencakup gerakan kematian  | Jangan mengarang modul; dokumentasikan batas perhitungan sampai spesifikasi fase kematian disetujui. |
| Deployment tanpa backup teruji                 | Kehilangan data saat insiden          | Backup dan restore test wajib sebelum go-live.                                                       |

---

# 19. Pelacakan requirement dan test

Gunakan pemetaan berikut sebagai minimum traceability. Detail test case harus diturunkan dari PRD dan Master Blueprint, bukan dibuat dengan mengubah aturan sumber.

| Area           | Requirement utama                                | Phase implementasi  | Bukti akhir                                            |
| -------------- | ------------------------------------------------ | ------------------- | ------------------------------------------------------ |
| Authentication | FR-AUTH-01 s.d. FR-AUTH-03                       | Phase 3             | Auth unit/integration tests                            |
| Penerimaan     | FR-REC-01 s.d. FR-REC-09                         | Phase 2, 4, 5       | TC-01 s.d. TC-32 dan acceptance PRD                    |
| Batch dan stok | FR-BATCH-01 s.d. FR-BATCH-04                     | Phase 2, 4, 6, 7    | Constraint, stock tests, concurrency tests             |
| POS            | FR-POS-01 s.d. FR-POS-05                         | Gate POS, Phase 7–9 | POS workflow tests                                     |
| Harga          | FR-PRICE-01 s.d. FR-PRICE-07                     | Gate POS, Phase 7–8 | Price CRUD, snapshot, authorization tests              |
| Penjualan      | FR-SALE-01 s.d. FR-SALE-04                       | Phase 7–9           | Sale transaction, sequence, history tests              |
| Pembayaran     | FR-PAY-01 s.d. FR-PAY-03                         | Phase 7–8           | Cash/transfer boundary tests                           |
| VOID penjualan | FR-VOID-SALE-01 s.d. FR-VOID-SALE-03             | Phase 7–9           | Reversal, stock restoration, repeated VOID tests       |
| Printing       | FR-PRINT-01 s.d. FR-PRINT-05                     | Gate POS, Phase 7–9 | Receipt content, printer matrix, failure/reprint tests |
| Audit          | FR-AUD-01                                        | Phase 2, 4, 7       | Atomic audit and access tests                          |
| Idempotency    | FR-IDEM-01                                       | Phase 2, 4, 7       | Retry and payload mismatch tests                       |
| Concurrency    | FR-CONC-01                                       | Phase 4, 6, 7, 9    | Locking and overselling tests                          |
| NFR            | NFR-SEC, DATA, TRANS, TIME, PERF, PRINT, UX, REG | Phase 2–10          | Security, load, regression, and operational reports    |

---

# 20. Kriteria akhir MVP siap go-live

MVP dapat dinyatakan siap go-live hanya jika seluruh poin berikut terpenuhi:

- [ ] Semua Task ID yang termasuk scope telah selesai atau memiliki pengecualian tertulis yang disetujui.
- [ ] Seluruh alur Penerimaan dan VOID Penerimaan sesuai Master Blueprint V4.5.
- [ ] Seluruh 32 test case V4.5 lulus.
- [ ] Seluruh acceptance criteria POS yang disetujui lulus.
- [ ] Tidak ada transaksi ganda akibat retry.
- [ ] Tidak ada stok negatif akibat concurrency.
- [ ] Semua VOID dicatat sebagai reversal; data historis asli tetap tersedia.
- [ ] RBAC backend dan privilege database sesuai matriks role.
- [ ] Audit dan transaksi bisnis konsisten secara atomik.
- [ ] Snapshot harga penjualan tidak berubah ketika katalog diperbarui.
- [ ] Kegagalan cetak tidak menggagalkan transaksi yang telah tersimpan.
- [ ] Cetak ulang dibatasi kepada pembuat transaksi dan transaksi non-VOID.
- [ ] Kompatibilitas printer hanya diklaim untuk kombinasi perangkat yang telah diuji.
- [ ] Backup dan restore telah diuji.
- [ ] Smoke test production lulus.
- [ ] Dokumentasi pengguna dan runbook tersedia.
- [ ] Pemilik proyek menyetujui release.

---

# 21. Riwayat dokumen

| Versi | Perubahan                                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0   | Rencana implementasi modular berdasarkan PRD 1.0, Master Blueprint V4.5, dan keputusan bisnis POS. Memisahkan implementasi V4.5 dari gerbang persetujuan teknis POS. |

**Akhir dokumen.**
