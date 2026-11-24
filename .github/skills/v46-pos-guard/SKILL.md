---
name: v46-pos-guard
description: Penjaga aturan domain, RBAC, tipe kuantitas, dan struk 9 field untuk POS Multi-Produk & Gerbang Siap Jual Batch (V4.6). Wajib dibaca sebelum memodifikasi modul pos, batches, atau UI kasir/katalog.
---

# Guardrails Implementasi V4.6 (POS Multi-Produk & Sale Readiness)

1. **Invarian Siklus Batch:**
   - Status siklus hidup (`active | completed | voided`) tidak pernah diubah langsung untuk urusan siap jual.
   - Syarat mutlak batch tampil dan dapat dijual di kasir: `status === 'active' && sale_readiness === 'SIAP_JUAL' && current_stock > 0`.
   - Mutasi `sale_readiness` hanya diizinkan untuk `Owner` dan `Kepala Budidaya` pada batch `active` dengan header `Idempotency-Key` (UUIDv4).

2. **Invarian Katalog & Kuantitas:**
   - `products` adalah satu-satunya sumber aktif harga & katalog (jangan gunakan `fish_sale_prices`).
   - `BATCH_TRACKED`: `quantity` wajib `INTEGER >= 1`, `unit_price` wajib bilangan bulat `> 0` dan `<= 10000000`, `stock_quantity` di tabel `products` wajib `NULL`, dan `batch_id` wajib dipilih saat transaksi.
   - `NON_BATCH`: `quantity` mendukung desimal `NUMERIC(12,2) > 0`, `unit_price` maks `NUMERIC(12,2)` (`> 0` dan `<= 10000000`), `species` & `size_label` wajib `NULL`, dan `batch_id` wajib `NULL` saat transaksi.

3. **Invarian Struk Sembilan Slot:**
   - Struk memiliki tepat sembilan slot berurutan: `company_name` (`PT. Pisciculture Farm Indonesia`), `transaction_date_time`, jenis ikan/produk, ukuran/kode varian, jumlah+unit sebagai satu slot, `unit_price`, `total_price`, `payment_method` (`CASH` atau `TRANSFER`), dan `cashier_name`.
   - Slot jenis ikan/produk memakai `species_name` untuk `BATCH_TRACKED` dan `product.name` untuk `NON_BATCH`.
   - Slot ukuran/kode varian memakai `fish_size` untuk `BATCH_TRACKED` dan `product.sku` untuk `NON_BATCH`. Tidak ada slot Kode Batch terpisah.
   - Response penjualan baru dan cetak ulang wajib mengembalikan struktur sembilan slot yang sama dengan pemetaan identik.
   - Jangan menambah slot, mengubah urutan, atau mengembalikan nilai `null` untuk kedua mode produk.
   - Jangan mengubah logic Web Bluetooth (`web-bluetooth-printer.ts` & `escpos-receipt.ts`) kecuali memperbaiki bug regresi V4.6 yang terbukti.
