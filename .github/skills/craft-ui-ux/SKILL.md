---
name: craft-ui-ux
description: Panduan arsitektur UI/UX bespoke, high-craft, dan ergonomis untuk sistem POS dan manajemen operasional budidaya ikan (Next.js, Tailwind CSS, shadcn/ui). Gunakan skill ini setiap kali membuat, mengedit, atau meninjau halaman frontend, komponen UI, layout, dan styling.
---

# Standar Desain UI/UX Operasional & POS (Anti-AI Generic)

Setiap antarmuka yang dibangun wajib terasa seperti perangkat lunak operasional kelas industri yang dirancang khusus—bukan template SaaS generik.

## 1. Larangan Keras (Anti-AI Cliché)
- **DILARANG** menggunakan gradasi ungu/indigo/pink (`from-indigo-500 to-purple-600`), efek *neon glow*, atau *glassmorphism* berlebihan yang menurunkan keterbacaan.
- **DILARANG** memakai bayangan tebal (`shadow-xl`, `shadow-2xl`) pada setiap kartu. Gunakan **batas garis presisi (`1px solid`)** dan perbedaan kontras permukaan (*tonal layering*) untuk memisahkan hierarki elemen.
- **DILARANG** membuang ruang layar untuk banner dekoratif atau sapaan generik (*"Selamat datang kembali di dashboard Anda!"*). Langsung tampilkan metrik operasional dan aksi utama.
- **DILARANG** menggunakan `lorem ipsum` atau istilah Inggris campuran yang kaku. Gunakan istilah operasional perikanan & kasir dalam Bahasa Indonesia yang ringkas dan akurat.

## 2. Palet Warna & Identitas Visual
Gunakan sistem warna korporat akuakultur dengan aturan proporsi **60% Netral Terang – 30% Biru Gelap/Struktur – 10% Aksen Fungsional**:
- **Canvas Utama:** `#F4F7FA` (abu-abu sejuk lembut untuk mengurangi silau layar kasir)
- **Permukaan Kartu / Panel:** `#FFFFFF` dengan border `#DCE4EC`
- **Primary Anchor / Header / Navigasi Aktif:** Dark Marine Blue (`#123B63`)
- **Primary Interactive / Tombol Utama / Fokus:** Sky Blue (`#20A9E8`) dengan hover `#178EC5`
- **Secondary Accent / Indikator Air & Kolam:** Teal (`#18B7B0`)
- **Status Sehat / Stok Aman / Transaksi Sukses:** Fresh Green (`#54B948`)
- **Status Peringatan / Mortalitas / Void:** Amber (`#D97706`) & Crimson (`#DC2626`)

## 3. Tipografi & Presisi Data Angka
- Gunakan font sans-serif geometris/humanis yang bersih (`Plus Jakarta Sans` atau `Inter`) dengan `tracking-tight` pada judul halaman dan `uppercase text-xs tracking-wider text-slate-500` pada label metadata.
- **Wajib `tabular-nums`:** Seluruh nominal harga (`Rp`), berat panen (`kg`), populasi (`ekor`), rasio FCR, dan kode batch **wajib** memakai class `tabular-nums` (dan font monospace untuk ID transaksi/struk) agar kolom angka rata vertikal sempurna.

## 4. Ergonomi Kasir (POS) & Kepadatan Informasi
- **Split-Workspace untuk POS:** Halaman kasir wajib memakai layout dua kolom asimetris (katalog produk/ukuran ikan dengan filter cepat di kiri `~65%`, panel keranjang timbangan & pembayaran yang selalu menempel/*sticky* di kanan `~35%`).
- **Target Sentuh & Klik:** Semua tombol aksi utama, pemilih spesies/ukuran ikan, dan tombol pembayaran memiliki tinggi minimal `44px` (`min-h-11`) agar nyaman di layar sentuh maupun mouse.
- **Tabel Operasional Padat & Jelas:** Gunakan *sticky table header*, zebra-striping halus atau garis pemisah tipis, serta badge status berbentuk *pill* dengan kontras tinggi.

## 5. Kelengkapan State & Audit Visual
- Setiap halaman wajib mengimplementasikan 4 kondisi lengkap: **Loading** (skeleton yang menyerupai bentuk tabel/kartu asli, bukan sekadar spinner tengah layar), **Empty State** (ikon monokrom + penjelasan singkat + tombol aksi utama), **Error State** (pesan jelas + tombol coba lagi), dan **Data State**.
- Sebelum menyelesaikan tugas UI pada Fase 3, gunakan tool browser (`#playwright`) jika aktif untuk memverifikasi tata letak desktop & tablet serta memastikan tidak ada teks terpotong atau *overflow* horizontal.
