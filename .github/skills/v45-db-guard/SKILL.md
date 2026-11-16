---
name: v45-db-guard
description: Audit skema Prisma, migrasi SQL, triggers immutability, dan granular DB roles sesuai kontrak V4.5 sebelum menjalankan migrate.
---

# SOP Audit Database & Migrasi V4.5

Saat membuat atau mengubah skema database:
1. Pastikan seluruh 8 tabel utama sesuai dengan `master_blueprint_api_contract_pfi_main.md` dan `architecture.md`.
2. Verifikasi bahwa operasi mutasi stok/transaksi bersifat append-only atau dilindungi trigger audit trail.
3. Pastikan setiap migrasi SQL memiliki komentar singkat mengenai tujuan constraint, trigger, dan hak akses role.
4. Uji migrasi pada database lokal dan pastikan script seed akun `OWNER` bersifat idempoten (aman dijalankan berulang kali).
