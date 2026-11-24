# ADR-0003: Pemisahan Gerbang Kesiapan Jual (`sale_readiness`) & Evolusi Katalog Multi-Produk POS (V4.6)

- **Status:** APPROVED — OWNER (V4.6 Baseline)
- **Tanggal:** 2026-11-23
- **Konteks:**
  Pada V4.5, seluruh batch budidaya berstatus `active` langsung muncul di layar Kasir POS, dan transaksi hanya mendukung ikan dari `fish_sale_prices`. Operasional lapangan membutuhkan pemisahan antara status siklus hidup kolam (`active | completed | voided`) dengan kelayakan panen/jual (`BELUM_SIAP | SIAP_JUAL`), serta penjualan produk umum non-kolam (pakan, probiotik, sarana budidaya).

- **Keputusan Arsitektur:**
  1. **Status Lifecycle vs Sale Readiness Terpisah:**
     - `batches.status` tetap dikelola oleh sistem & trigger V4.5 (`active`, `completed`, `voided`).
     - `batches.sale_readiness` (`BELUM_SIAP` default | `SIAP_JUAL`) dikontrol eksklusif oleh `Kepala Budidaya` dan `Owner`.
     - Syarat mutlak batch tampil & dapat dijual di kasir: `status = 'active' AND sale_readiness = 'SIAP_JUAL' AND current_stock > 0`.
  2. **Evolusi Katalog Produk (`products` & `product_categories`):**
     - Menggantikan `fish_sale_prices` sebagai _Single Source of Truth_ tanpa menghapus tabel lama (menjaga integritas migrasi historis).
     - Mendukung `BATCH_TRACKED` (kuantitas `INTEGER >= 1`, stok agregat dari batch `SIAP_JUAL`, wajib pilih `batch_id` saat checkout) dan `NON_BATCH` (kuantitas `NUMERIC(12,2) > 0`, stok langsung di `products.stock_quantity`, `batch_id = NULL`).
  3. **Kompatibilitas Struk 9 Field & Append-Only Ledger:**
     - `fish_sales` tetap 1 item per nomor struk harian (`sale_daily_sequences`) dan tetap _append-only_.
     - Untuk transaksi `NON_BATCH`, kolom Kode Batch pada struk 9 field dipetakan ke `product.sku` dan kolom Jenis/Ukuran dipetakan ke `product.name`.

- **Konsekuensi:**
  - Tidak ada perubahan pada trigger immutability V4.5 maupun alur cetak thermal Bluetooth 58mm/80mm.
  - Penambahan fitur multi-item cart atau modul pembelian supplier ditunda ke versi pasca-V4.6.
