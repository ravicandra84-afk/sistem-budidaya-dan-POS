# Checklist UAT Lapangan — V4.6 (PC & HP Android Bluetooth)

## Skenario 1: Gerbang Kesiapan Jual (Kepala Budidaya)

1. Login sebagai **Kepala Budidaya** -> buka menu **Batch & penerimaan** -> pilih batch `active` (status `BELUM_SIAP`).
2. Pastikan tombol **Tandai SIAP_JUAL** muncul, isi catatan sortir, lalu simpan.
3. Verifikasi badge berubah menjadi `SIAP_JUAL` dan tercatat di **Riwayat Kesiapan Jual**.
4. Login sebagai **Admin Operasional** atau **Kasir** -> buka detail batch yang sama -> pastikan tombol ubah `SIAP_JUAL` **tidak muncul**.

## Skenario 2: Manajemen Katalog Multi-Produk (Admin Operasional)

1. Login sebagai **Admin Operasional** -> buka menu **Daftar harga / Katalog Produk**.
2. Tambah 1 produk `BATCH_TRACKED` (sesuai jenis & ukuran batch yang sudah `SIAP_JUAL`) dan 1 produk `NON_BATCH` (misal Pakan stok `10 SAK`).
3. Uji validasi: coba masukkan harga `0` atau `15.000.000` -> pastikan ditolak sistem.
4. Uji arsip: arsipkan 1 produk uji -> pastikan hilang dari layar kasir tanpa menghapus riwayat transaksi lama.

## Skenario 3: Transaksi Kasir & Cetak Thermal Bluetooth (Kasir)

1. Login sebagai **Kasir** -> buka **POS / Kasir**.
2. Pastikan batch yang masih `BELUM_SIAP` **tidak muncul** di pilihan produk.
3. Pilih produk ikan (`BATCH_TRACKED`) -> pilih batch spesifik yang berstatus `SIAP_JUAL` -> input jumlah ekor bulat -> selesaikan pembayaran tunai.
4. Pilih produk umum (`NON_BATCH`) -> input jumlah tanpa memilih batch -> selesaikan pembayaran tunai.
5. Buka detail kedua struk tersebut -> verifikasi **9 field struk** terisi rapi (kode SKU tampil pada field batch untuk produk `NON_BATCH`) -> tekan **Cetak Thermal (Bluetooth)** pada HP Android dan pastikan struk tercetak bersih di kertas 58mm/80mm.
6. Ubah kembali batch tadi menjadi `BELUM_SIAP` lewat akun **Kepala Budidaya** -> pastikan produk tersebut langsung hilang dari layar **POS / Kasir**.
