# Laporan Audit Repository PFI

| Informasi | Nilai |
| --- | --- |
| Task | P0-01 — Audit repository awal |
| Tanggal pemeriksaan | 2026-11-17 |
| Basis audit | Isi repository dan worktree pada tanggal pemeriksaan; perubahan lokal yang sudah ada dipertahankan |
| Status | Selesai dengan pemeriksaan database terbatas |

## Ringkasan

Repository bukan proyek kosong. Monorepo npm dengan workspace `apps/api`, `apps/web`, dan `packages/shared` tersedia, stack telah dikunci pada ADR 0001, serta alur Receiving/Batch V4.5 memiliki implementasi backend, UI, migrasi, seeding, dan test. Pemeriksaan lint, build, typecheck, dan test standar berhasil.

POS belum memiliki schema, endpoint, maupun halaman implementasi. Dua suite test yang membutuhkan PostgreSQL khusus dilewati pada test standar; migrasi dan test database belum diverifikasi pada `pfi_test`. Beberapa dokumen masih memuat pernyataan lama yang tidak sesuai dengan keputusan owner dan keadaan repository saat ini.

## Inventaris

| Area | Status | Bukti repository |
| --- | --- | --- |
| Workspace dan package manager | EXISTS | Root [package.json](package.json) mendefinisikan npm workspaces: `apps/api`, `apps/web`, dan `packages/shared`; lockfile tersedia. |
| Stack aplikasi | EXISTS | ADR [0001-monorepo-stack-and-list-contract.md](docs/adr/0001-monorepo-stack-and-list-contract.md) berstatus `APPROVED — OWNER`; manifest menunjukkan NestJS/TypeScript, Next.js/React, Prisma/PostgreSQL, Zod, class-validator, Jest, dan Supertest. |
| API bootstrap | EXISTS | [main.ts](apps/api/src/main.ts) membuat aplikasi NestJS, memasang prefix API, filter error, security, dan validasi global. Modul didaftarkan pada [app.module.ts](apps/api/src/app.module.ts). |
| Modul backend V4.5 | EXISTS | Auth, species, receiving, batches, audit, dan Prisma berada di `apps/api/src/modules/`. Controller menyediakan login, baca species, daftar/detail batch, buat/VOID penerimaan, dan baca audit log. |
| Auth dan RBAC | EXISTS | Guard JWT dan role tersedia di `apps/api/src/common/auth/`; controller menerapkan role pada operasi yang diperiksa. Penerimaan dibuat oleh `Owner`, `Admin Operasional`, atau `Kepala Budidaya`; VOID oleh `Owner` atau `Admin Operasional`. |
| Database V4.5 | EXISTS | [schema.prisma](apps/api/prisma/schema.prisma) memodelkan delapan tabel V4.5: `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, dan `audit_logs`. Dua migrasi tersedia pada `apps/api/prisma/migrations/`. |
| Seed dan provisioning | EXISTS | Script seed species, provisioning Owner, dan provisioning runtime role tersedia pada `apps/api/prisma/`. Script migrasi/test database terpisah tersedia pada `apps/api/scripts/`. |
| UI operasional Receiving/Batch | EXISTS | Halaman login, daftar batch, detail batch, form penerimaan, dan audit tersedia pada `apps/web/src/app/`. Aksi VOID penerimaan tersedia di halaman detail batch. |
| POS | MISSING | Tidak ditemukan modul, schema/migrasi, endpoint, atau halaman POS. Implementasi POS tetap menunggu Gate POS dan keputusan teknis yang belum terselesaikan; lihat [AGENTS.md](AGENTS.md) bagian 8.2 dan ADR 0001. |
| Test framework | EXISTS | API memakai Jest + Supertest dengan konfigurasi di [jest.config.cjs](apps/api/jest.config.cjs). Test mencakup auth, API, env, idempotency, pagination, security, dan kontrak/database V4.5. Tidak ada script test web pada manifest saat ini. |
| Contoh konfigurasi lokal | EXISTS | `.env.example` dan `.gitignore` tersedia. [README.md](README.md) mendokumentasikan setup, perintah pemeriksaan, serta pembatasan target database lokal. |
| Deployment dan generator dokumentasi API | NOT SELECTED | Belum dipilih dalam ADR 0001; audit ini tidak menyimpulkan vendor atau generator tertentu. |

## Pemeriksaan Aman

Perintah berikut dijalankan dari root repository:

| Perintah | Hasil |
| --- | --- |
| `git status --short --branch` | Branch `main` mengikuti `origin/main`; worktree sudah memiliki perubahan tracked dan untracked sebelum audit. Perubahan tersebut dipertahankan. |
| `npm ls --depth=0` | PASS; dependency workspace terpasang dan terhubung. npm mengeluarkan peringatan konfigurasi global/env `tmp` yang tidak dikenal, tetapi perintah berhasil. |
| `npm run lint` | PASS; ESLint selesai tanpa temuan. |
| `npm run build` | PASS; build shared, API, dan Next.js selesai. Build Next.js mengubah referensi generated pada `apps/web/next-env.d.ts`; perubahan yang hanya berasal dari pemeriksaan ini dipulihkan ke isi awal. |
| `npm run typecheck` | PASS untuk API, web, dan shared. |
| `npm test` | PASS sebagian: 7 suite lulus, 46 test lulus; 2 suite dan 37 test dilewati. Kedua suite database dikondisikan pada `RUN_V45_DB_TESTS=1` dan memerlukan database lokal `pfi_test`. |
| Migrasi/test PostgreSQL | NOT RUN; tidak menjalankan migrasi atau suite database karena belum memverifikasi konfigurasi dan keadaan database lokal `pfi_test`. Tidak ada operasi database yang dilakukan. |

Hasil ini bukan bukti bahwa seluruh 32 skenario V4.5 resmi, migrasi PostgreSQL, atau performance SLA sudah lulus. Hal tersebut masih perlu diverifikasi melalui setup test database dan kondisi staging yang ditetapkan blueprint.

## Konflik dan Ketidaksinkronan

1. [README-INSTALL.md](README-INSTALL.md) menyebut source belum diaudit, framework final belum dipilih, dan P0-01 masih menjadi tugas awal. Pernyataan itu tidak lagi sesuai dengan source yang sekarang tersedia dan ADR 0001 yang telah disetujui. Perbarui dokumentasi instalasi pada pekerjaan dokumentasi terpisah.
2. Matriks role pada [architecture.md](architecture.md) bagian 3.2 masih menolak Owner untuk membuat dan VOID penerimaan; [master_blueprint_api_contract_pfi_main.md](master_blueprint_api_contract_pfi_main.md) bagian 5.2 juga mencantumkan VOID khusus Admin Operasional. Ini bertentangan dengan persetujuan Owner tanggal 2026-11-17 yang dicatat dalam `AGENTS.md` dan matriks PRD, serta dengan controller aktual. Implementasi saat ini mengizinkan Owner dan Admin Operasional untuk VOID. Sesuai hierarki sumber keputusan, keputusan Owner terbaru yang eksplisit berlaku; sinkronisasi dokumen lama perlu dilakukan secara terpisah.

## Batas Audit

- Pemeriksaan database hanya berdasarkan schema, migrasi, konfigurasi, dan test yang ada di repository; database lokal tidak diperiksa atau diubah.
- Test PostgreSQL dan benchmark resmi tidak dijalankan.
- Audit ini tidak mengubah file aplikasi, kontrak produk, skema, atau keputusan gate. Deliverable P0-01 adalah laporan ini.