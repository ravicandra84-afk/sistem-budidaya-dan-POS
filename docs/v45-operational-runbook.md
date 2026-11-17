# Runbook Operasional Database V4.5

| Item                 | Nilai                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task                 | P1-03 - Rencana migrasi dan perlindungan data; P3-03 - Provisioning akun awal                                                                                   |
| Cakupan              | Migrasi PostgreSQL V4.5, seed spesies, backup/restore, Owner awal, dan runtime role                                                                             |
| Persyaratan database | PostgreSQL 13+                                                                                                                                                  |
| Status               | SOP P1-03/P3-03; Owner provisioning lokal dijalankan dua kali pada 2026-11-17 dan tidak mengubah akun yang sudah ada; backup/restore rehearsal belum dijalankan |

## Batas Operasi dan Keamanan

- Jalankan perubahan skema hanya melalui migrasi terkontrol. Jangan gunakan `prisma migrate reset`, `prisma db push`, `DROP DATABASE`, atau SQL manual untuk mengulang migrasi pada database berisi data.
- Database lokal operasional bernama `pfi_db`; database test terisolasi bernama `pfi_test`. Jangan arahkan suite test, fixture, atau cleanup test ke `pfi_db`.
- Perintah migrasi tidak dijalankan dalam task dokumentasi ini. Sebelum deployment nyata, verifikasi target, backup, hak operator, dan persetujuan perubahan.
- Simpan `DATABASE_URL`, `MIGRATION_DATABASE_URL`, kredensial backup, dan password runtime pada secret manager atau file kredensial berizin terbatas. Jangan menaruh URL berkredensial pada command, log, issue, atau dokumentasi.
- Target hosting, retensi backup, lokasi backup, RPO/RTO, dan prosedur cutover produksi belum dipilih. Tetapkan dengan pemilik sistem sebelum operasi produksi; jangan mengarang nilai atau menganggap backup lokal sebagai backup produksi.

## Artefak dan Batasan Repository

- Migrasi yang saat ini tersedia: `20261116000000_v45_initial` dan `20261116010000_v45_business_date_guard`.
- Prisma menggunakan `DATABASE_URL` untuk koneksi aplikasi dan `MIGRATION_DATABASE_URL` untuk koneksi migrasi langsung.
- `npm run db:migrate:deploy --workspace @pfi/api` menjalankan `prisma migrate deploy` melalui wrapper, tetapi wrapper tidak membatasi host atau nama database. Operator wajib mengonfirmasi target dari konfigurasi rahasia sebelum perintah dijalankan.
- `npm run db:provision-runtime-role --workspace @pfi/api` dan `npm run db:seed:species --workspace @pfi/api` memakai helper lokal yang hanya mengizinkan host loopback dan database `pfi_db`; keduanya bukan prosedur deployment remote.
- Role helper membuat `pfi_app_runtime` sebagai `NOLOGIN` dan bila role sudah ada tidak mengubah atau memvalidasi atributnya. Credential/login role perlu disiapkan terpisah secara aman oleh operator database. Jangan memasukkan password ke migrasi.
- Seed spesies memakai `createMany(skipDuplicates: true)`: menjalankan ulang aman untuk code yang sama dan tidak memperbarui baris yang sudah ada.

## Urutan Perubahan Database

### 1. Preflight

1. Pastikan task/change yang disetujui, environment target, versi PostgreSQL (13+), serta nama database benar.
2. Pastikan `MIGRATION_DATABASE_URL` menunjuk ke database dan host target yang dimaksud. Perintah `db:migrate:deploy` tidak memberi proteksi target tambahan.
3. Pastikan kredensial migrasi terpisah dari kredensial runtime. Runtime tidak boleh memakai role pemilik skema atau role migrasi.
4. Periksa status migrasi dan perubahan SQL yang akan diterapkan. Migrasi Prisma bersifat berurutan berdasarkan `_prisma_migrations`; file SQL yang sama bukan script untuk dijalankan ulang secara manual.
5. Buat backup sebelum migrasi dan pastikan artefak backup dapat dibaca serta punya checksum. Untuk perubahan berisiko, lakukan restore rehearsal ke database scratch terlebih dahulu.
6. Untuk produksi, koordinasikan dampak terhadap penulisan aplikasi dan maintenance window sesuai hasil review migration. Strategi zero-downtime belum ditetapkan.

### 2. Provisioning Role dan Migrasi

Pada lingkungan lokal yang memang menggunakan `pfi_db`, perintah yang tersedia adalah:

```sh
npm run db:provision-runtime-role --workspace @pfi/api
npm run db:migrate:deploy --workspace @pfi/api
npm run db:seed:species --workspace @pfi/api
```

Urutan tersebut memastikan role yang dirujuk perintah `GRANT` sudah ada sebelum migrasi awal dijalankan. Untuk environment remote/produksi, gunakan bootstrap role dan proses deployment yang dikelola DBA/CI; helper lokal menolak host remote, sedangkan perintah migrate deploy tidak. Jangan mengubah guard tersebut atau mengarahkan helper lokal ke produksi sebagai jalan pintas.

Migrasi pertama membuat delapan tabel V4.5, constraint/index, trigger deferred batch-receipt, trigger imutabilitas, status guard, dan privilege runtime. Migrasi berikutnya menambahkan validasi tanggal bisnis `Asia/Jakarta`. Jalankan migration files sesuai urutan Prisma dan jangan mengeksekusi ulang SQL secara manual.

Seed resmi saat ini: `LELE`, `PATIN`, `GURAME-MERAH`, `GURAME-HITAM`, `NILA-HITAM`, dan `NILA-MERAH`. Seed lokal bersifat insert-only untuk code yang belum ada; perubahan nama/status master existing perlu perubahan data yang direview, bukan asumsi bahwa seed akan memperbaruinya.

## SOP Provisioning Akun Awal `Owner`

Keputusan ADR 0001 mengizinkan provisioning awal secara lokal melalui CLI dari `.env` yang diabaikan Git. Tidak ada registrasi publik, halaman administrasi akun, atau reset password pada MVP.

### Prasyarat dan Prosedur Lokal

1. Pastikan migrasi yang membuat tabel `users` sudah sukses pada database lokal `pfi_db`. Helper provisioning memakai `MIGRATION_DATABASE_URL` dan menolak host selain loopback atau database selain `pfi_db`.
2. Bila `.env` belum ada, salin `.env.example` tanpa menimpa file lokal yang sudah ada. Batasi akses file lokal, misalnya `umask 077` sebelum membuatnya lalu `chmod 600 .env`. Pastikan `.env` tetap di-ignore Git (`.gitignore` mengabaikan `.env` dan `.env.*`, dengan pengecualian `.env.example`).
3. Isi variabel lokal `SEED_INITIAL_OWNER_NAME`, `SEED_INITIAL_OWNER_EMAIL`, dan `SEED_INITIAL_OWNER_PASSWORD`. Ganti seluruh nilai contoh `CHANGE_ME`; jangan menaruh nilai asli pada command line, terminal history, tiket, log, atau chat.
4. Jalankan dari root repository:

```sh
npm run db:provision-owner
```

5. CLI memvalidasi nama 1–255 karakter, format email, dan password. Password disimpan sebagai bcrypt hash; plaintext tidak ditulis ke database.
6. Setelah command selesai, verifikasi hanya metadata akun yang diperlukan (`id`, name/email yang sesuai, role `Owner`, dan `is_active = true`). Jangan memilih, menampilkan, atau menyalin kolom `password_hash`.
7. Lakukan login uji melalui alur aplikasi dengan password dari password manager; jangan mencetak token atau menaruhnya pada laporan.

### Idempotensi dan Aturan Password

- CLI mencari email secara case-insensitive. Jika email sudah ada, CLI tidak mengubah nama, password, role, atau status akun. Konflik unique akibat provisioning bersamaan juga berakhir sebagai “sudah ada” tanpa update.
- Menjalankan ulang command bukan cara reset password, mengaktifkan akun, atau mengubah role. Jika email sudah dipakai akun yang bukan Owner atau statusnya nonaktif, hentikan dan minta keputusan/operator berwenang; jangan mengedit akun historis secara manual.
- Validasi yang benar-benar ditegakkan CLI: password 12–72 karakter dan tidak boleh diawali literal `CHANGE_ME` (pemeriksaan prefix case-sensitive). CLI tidak menegakkan kelas karakter huruf besar/kecil, angka, atau simbol.
- Rekomendasi operasional, bukan rule tambahan yang ditegakkan kode: gunakan password unik, panjang, acak dari password manager, jangan dipakai ulang, dan simpan hanya di secret store lokal yang berizin terbatas. Placeholder `SEED_INITIAL_OWNER_PASSWORD` di `.env.example` sengaja tidak valid untuk provisioning.
- CLI memakai `BCRYPT_SALT_ROUNDS` dengan default 12 jika variabel tidak disetel. Jika override digunakan, operator harus memastikan nilainya integer 10–15; loader konfigurasi API memvalidasi rentang ini, tetapi CLI provisioning sendiri hanya mengonversi nilai menjadi angka.
- Provisioning remote/produksi tidak didukung helper ini karena guard `getLocalMigrationUrl()` hanya mengizinkan loopback `pfi_db`. ADR yang disetujui saat ini hanya mengunci CLI lokal. Jangan menghapus guard atau menjalankan command terhadap remote; prosedur produksi memerlukan keputusan dan jalur DBA/CI yang disetujui.

## SOP Setup `pfi_app_runtime`

Pemisahan role: `MIGRATION_DATABASE_URL` memakai credential DBA/migration untuk DDL; `DATABASE_URL` aplikasi memakai `pfi_app_runtime` dengan DML granular. Jangan gunakan credential migration untuk proses API.

### Provision dan Login Role

1. Untuk local `pfi_db`, buat role dasar sebelum migration memberi grants:

```sh
npm run db:provision-runtime-role --workspace @pfi/api
```

Helper membuat `pfi_app_runtime NOLOGIN`. Jika role sudah ada, helper tidak mengubah atau memvalidasi atributnya. 2. Jalankan migration yang disetujui agar grants granular V4.5 diterapkan. Untuk remote environment, bootstrap role dan grants harus dilakukan melalui DBA/CI; helper lokal menolak koneksi remote. 3. Verifikasi dahulu role bukan superuser dan tidak memiliki `CREATEDB`, `CREATEROLE`, atau replication privilege. Dalam sesi DBA `psql` yang aman, set password melalui prompt interaktif saat role masih `NOLOGIN`, lalu aktifkan `LOGIN`:

```psql
\password pfi_app_runtime
ALTER ROLE pfi_app_runtime LOGIN;
```

Perintah `\password` meminta input tersembunyi dan tidak menaruh password sebagai literal SQL dalam history. Jangan memakai `ALTER ROLE ... PASSWORD '<secret>'`, memasukkan password pada URI command, atau membagikannya di log/chat. Database password-complexity policy tidak divalidasi oleh repository; gunakan password unik yang dihasilkan password manager dan kontrol secret organisasi.

4. Simpan `DATABASE_URL` dengan username `pfi_app_runtime` pada secret store environment aplikasi. Simpan `MIGRATION_DATABASE_URL` pada secret store terpisah dan hanya injeksikan saat operasi migrasi. Untuk lokal, `.env` di root boleh digunakan dengan permission terbatas; jangan commit atau mencetak isinya.
5. Validasi koneksi menggunakan konfigurasi aplikasi dan jalankan query pemeriksaan role/grants pada bagian [Verifikasi Granular](#verifikasi-granular-pfi_app_runtime). Jangan memperluas grants untuk mengatasi kegagalan; identifikasi privilege yang kurang dan review migration terlebih dahulu.

### Verifikasi Pasca-Setup

- Role harus muncul tepat satu kali dan atributnya sesuai prinsip least privilege. Jika role sudah ada sebelum helper dijalankan, jangan menganggap konfigurasi benar; jalankan query atribut dan privilege secara eksplisit.
- Pastikan role dapat melakukan operasi runtime yang memang diizinkan, dan tidak dapat mengubah/menghapus receipt, VOID, atau audit historis. Gunakan test database untuk uji mutasi negatif, bukan database operasional.
- Rotasi password runtime dilakukan melalui secret store dan prosedur DBA yang disetujui. Account lifecycle Owner (reset password, deaktivasi, perubahan role) belum memiliki fitur/API; tidak termasuk SOP provisioning awal.

### 3. Verifikasi Setelah Migrasi

1. Pastikan proses migrasi berakhir sukses dan seluruh migration yang diharapkan tercatat selesai pada `_prisma_migrations`.
2. Pastikan delapan tabel V4.5 ada: `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, `audit_logs`.
3. Periksa constraint, index, function, trigger, dan seed terhadap migration SQL serta blueprint sebelum membuka trafik aplikasi.
4. Jalankan suite database hanya pada `pfi_test`, dengan `TEST_DATABASE_URL` lokal yang sudah diverifikasi. Suite tersebut menghapus fixture pada database test dan tidak boleh diarahkan ke `pfi_db`.
5. Verifikasi privilege memakai bagian checklist berikut. Jangan menyimpulkan privilege benar hanya karena migration deploy sukses.

## Checklist Integritas V4.5

| Area                 | Kondisi yang harus dipenuhi                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Relasi receipt/batch | `incoming_fish.batch_id` unik; deferred constraint trigger memastikan setiap batch memiliki satu receipt saat commit.                |
| Input penerimaan     | Check constraint untuk quantity, modal, sampel berat, ukuran ikan, dan tanggal bisnis sesuai kontrak V4.5.                           |
| Reference integrity  | Foreign key menjaga spesies, aktor, receipt, dan batch; relasi historis menggunakan `ON DELETE RESTRICT`.                            |
| Sequence             | `batch_daily_sequences.entry_date` primary key; `last_number` 0–999; nomor tidak didaur ulang setelah VOID.                          |
| Immutable history    | Trigger menolak UPDATE/DELETE pada `incoming_fish`, `incoming_fish_voids`, dan `audit_logs`; runtime juga tidak diberi hak tersebut. |
| Status batch         | Nilai resmi `active`, `completed`, `voided`; trigger membatasi transisi dan tidak mengizinkan reaktivasi `voided`.                   |
| Idempotency          | Unique `(user_id, endpoint, idempotency_key)`; runtime hanya boleh mengubah kolom hasil/status yang ditetapkan.                      |
| Audit                | Action V4.5 hanya `CREATE_ENTRY` dan `VOID_ENTRY`; insert audit berjalan dalam transaksi mutasi.                                     |
| Privilege PUBLIC     | Hak akses `PUBLIC` pada tabel/fungsi terkait dicabut sebelum grant ke runtime.                                                       |

## Verifikasi Granular `pfi_app_runtime`

Jalankan pemeriksaan berikut dengan akun DBA/migration yang berwenang, bukan dari kredensial aplikasi. Hasilnya adalah pemeriksaan konfigurasi; uji koneksi dan perilaku runtime tetap diperlukan secara terpisah.

### Atribut Role

```sql
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles
WHERE rolname = 'pfi_app_runtime';
```

Ekspektasi: tepat satu baris; `rolsuper`, `rolcreatedb`, `rolcreaterole`, dan `rolreplication` bernilai `false`. Role yang baru dibuat helper memiliki `rolcanlogin = false`. Jika aplikasi menghubungkan langsung sebagai `pfi_app_runtime`, DBA harus menyiapkan metode login secara eksplisit di luar migration dan mengelola secret dengan aman; verifikasi ulang atribut sesudahnya. Jangan mengganti role runtime dengan superuser untuk memperbaiki kegagalan koneksi.

### Hak Tabel dan Kolom

```sql
SELECT
  has_table_privilege('pfi_app_runtime', 'public.users', 'SELECT') AS users_select,
  has_table_privilege('pfi_app_runtime', 'public.fish_species', 'SELECT') AS species_select,
  has_table_privilege('pfi_app_runtime', 'public.incoming_fish', 'SELECT') AS receipt_select,
  has_table_privilege('pfi_app_runtime', 'public.incoming_fish', 'INSERT') AS receipt_insert,
  has_table_privilege('pfi_app_runtime', 'public.incoming_fish', 'UPDATE') AS receipt_table_update,
  has_table_privilege('pfi_app_runtime', 'public.incoming_fish', 'DELETE') AS receipt_delete,
  has_table_privilege('pfi_app_runtime', 'public.incoming_fish_voids', 'INSERT') AS void_insert,
  has_table_privilege('pfi_app_runtime', 'public.audit_logs', 'INSERT') AS audit_insert,
  has_table_privilege('pfi_app_runtime', 'public.audit_logs', 'UPDATE') AS audit_update,
  has_table_privilege('pfi_app_runtime', 'public.audit_logs', 'DELETE') AS audit_delete,
  has_column_privilege('pfi_app_runtime', 'public.batch_daily_sequences', 'last_number', 'UPDATE') AS sequence_counter_update,
  has_column_privilege('pfi_app_runtime', 'public.batch_daily_sequences', 'entry_date', 'UPDATE') AS sequence_date_update,
  has_column_privilege('pfi_app_runtime', 'public.batches', 'status', 'UPDATE') AS batch_status_update,
  has_column_privilege('pfi_app_runtime', 'public.batches', 'batch_code', 'UPDATE') AS batch_code_update,
  has_column_privilege('pfi_app_runtime', 'public.idempotency_keys', 'response_body', 'UPDATE') AS idempotency_response_update,
  has_column_privilege('pfi_app_runtime', 'public.idempotency_keys', 'payload_hash', 'UPDATE') AS idempotency_hash_update;
```

Ekspektasi:

- Semua kolom hak yang dimaksudkan bernilai `true`: SELECT users/species/receipt, INSERT receipt/VOID/audit, UPDATE `batch_daily_sequences.last_number`, UPDATE `batches.status`, UPDATE `idempotency_keys.response_body`.
- Semua kolom larangan bernilai `false`: UPDATE/DELETE receipt, UPDATE/DELETE audit, UPDATE `batch_daily_sequences.entry_date`, UPDATE `batches.batch_code`, dan UPDATE `idempotency_keys.payload_hash`.
- Periksa juga tabel yang belum diringkas dalam query: `incoming_fish_voids` hanya SELECT/INSERT; `batch_daily_sequences` SELECT/INSERT plus UPDATE kolom `last_number`; `batches` SELECT/INSERT plus UPDATE kolom `status`; `idempotency_keys` SELECT/INSERT plus UPDATE kolom `status`, `response_status`, `response_body`, `completed_at`; `audit_logs` SELECT/INSERT. `users` dan `fish_species` hanya SELECT.

### Uji Efektif Tanpa Menulis Data

Untuk memeriksa hak effective role tanpa memakai credential runtime, DBA dapat menjalankan transaksi read-only dan `SET LOCAL ROLE` pada database test yang sudah disiapkan:

```sql
BEGIN READ ONLY;
SET LOCAL ROLE pfi_app_runtime;
SELECT current_user, current_database();
SELECT count(*) FROM fish_species;
ROLLBACK;
```

Jangan memakai percobaan INSERT/UPDATE/DELETE terhadap data operasional. Uji penolakan mutasi historis menggunakan suite DB terisolasi, bukan tabel produksi.

## Backup, Restore, dan Rollback

### Backup Sebelum Perubahan

1. Gunakan prosedur backup PostgreSQL yang disetujui untuk environment tersebut. Untuk backup logis, format custom mendukung inspeksi dan restore selektif.
2. Password tidak boleh menjadi argumen literal command. Gunakan secret manager atau `.pgpass` dengan permission filesystem terbatas dan alias service lokal.
3. Contoh pola command; nilai environment harus diisi operator melalui mekanisme secret yang disetujui, bukan disimpan di dokumen:

```sh
pg_dump --format=custom --file="$PFI_BACKUP_FILE" --dbname="$PFI_BACKUP_SERVICE"
pg_restore --list "$PFI_BACKUP_FILE" >/dev/null
sha256sum "$PFI_BACKUP_FILE"
```

4. Simpan backup di lokasi terpisah dari host/database sumber dan pastikan enkripsi, akses, serta retention sesuai kebijakan pemilik. Kebijakan tersebut belum ditetapkan repository.
5. Backup dianggap dapat dipakai setelah berhasil di-restore ke database scratch terisolasi dan hasil verifikasi tabel/constraint dapat dibaca.

### Restore Rehearsal

Restore dilakukan ke database baru yang kosong dan terisolasi. Dump satu database tidak mencakup definisi role cluster; siapkan role/ownership yang diperlukan melalui prosedur DBA terpisah sebelum restore yang mempertahankan ACL. Jangan menyalin password ke dump dokumentasi atau menggunakan opsi `--clean` pada database yang berisi data.

```sh
createdb --maintenance-db="$PFI_ADMIN_SERVICE" "$PFI_RESTORE_DATABASE"
pg_restore --exit-on-error --dbname="$PFI_RESTORE_SERVICE" "$PFI_BACKUP_FILE"
```

Setelah restore, validasi jumlah tabel, migration history, constraints/triggers, data master, serta query baca. Hapus database scratch hanya setelah pemeriksaan dan persetujuan operator; jangan pernah mengarahkan `PFI_RESTORE_SERVICE` ke `pfi_db` atau produksi.

### Strategi Rollback Migrasi

- Prisma migration dalam repository ini tidak menyediakan pasangan down migration. `migrate deploy` melanjutkan migration yang belum diterapkan; ia bukan mekanisme rollback.
- Jika deploy gagal, hentikan deploy lanjutan dan trafik mutasi bila integritas skema/data belum pasti. Simpan output command dan periksa `_prisma_migrations` serta DDL aktual sebelum tindakan pemulihan.
- Jangan menghapus baris migration history atau menjalankan `migrate resolve` sebagai tebakan. `migrate resolve --rolled-back` hanya boleh dilakukan setelah operator membuktikan migration gagal telah dibatalkan sepenuhnya dan objek/database sesuai keadaan sebelum retry.
- Untuk kerusakan data atau schema yang tidak dapat diperbaiki secara aman, restore backup ke database baru, validasi, lalu lakukan cutover hanya melalui prosedur perubahan yang disetujui. Backup lama jangan ditimpa sebelum cutover tervalidasi.
- Jika data baru sudah diterima setelah backup dan belum ada strategi point-in-time recovery yang disetujui, restore dapat menghilangkan transaksi tersebut. Hentikan cutover dan minta keputusan pemilik tentang rekonsiliasi/kehilangan data; jangan melakukan restore in-place secara otomatis.
- Utamakan migration forward-fix yang direview untuk koreksi skema ketika data bisa dipertahankan. Semua koreksi data bisnis harus melalui mekanisme domain yang sah, bukan edit/delete receipt atau audit historis.

## Catatan Belum Terselesaikan

1. Deployment remote belum memiliki wrapper target-guard setara helper lokal. Sebelum produksi, tetapkan prosedur CI/DBA yang memvalidasi host/database serta memastikan credential migrasi tidak dipakai aplikasi.
2. Role helper hanya menjamin create-if-absent `NOLOGIN`; ia tidak membuktikan privilege aktual dan tidak menyiapkan login runtime. Checklist SQL di atas wajib dijalankan setelah bootstrap dan grant.
3. Retention dan lokasi backup, enkripsi, RPO/RTO, serta prosedur cutover harus ditetapkan pemilik/operasi sebelum deployment produksi.
4. Helper local Owner dan runtime role menolak target database remote; bootstrap operasional remote memerlukan prosedur DBA/CI yang disetujui sebelum digunakan.

## Referensi Repository

- [Rencana implementasi P1-03](../implementation_plan.md)
- [Master Blueprint V4.5](../master_blueprint_api_contract_pfi_main.md)
- [Arsitektur](../architecture.md)
- [Prisma schema](../apps/api/prisma/schema.prisma)
- [Migrasi baseline V4.5](../apps/api/prisma/migrations/20261116000000_v45_initial/migration.sql)
- [Migrasi tanggal bisnis](../apps/api/prisma/migrations/20261116010000_v45_business_date_guard/migration.sql)
- [Provisioning role lokal](../apps/api/prisma/provision-runtime-role.ts)
- [Provisioning Owner lokal](../apps/api/prisma/provision-owner.ts)
- [Runtime URL guards](../apps/api/prisma/runtime-env.ts)
- [Environment template](../.env.example)
- [Git ignore rules](../.gitignore)
- [API environment validation](../apps/api/src/config/env.ts)
- [Seed spesies](../apps/api/prisma/seed-species.ts)
- [Script migrasi Prisma](../apps/api/scripts/prisma-cli.ts)
