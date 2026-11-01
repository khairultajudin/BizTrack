# BizTrack — Permintaan Upgrade Puan Hana (Akademik Mega)

**Tarikh terima:** 24 Oktober 2026
**Status:** October 2026 subscription **SUDAH BAYAR**
**Sumber:** Khairul (MK Venture Maker Solution)
**Repo:** `C:\Users\user\BizTrack` · Stack: React 18 + Vite + Supabase (Vercel)

---

## Ringkasan

Tiga (3) request baharu, semua untuk workspace yang sama (tiada bizTrack baharu):

| # | Modul | Ringkasan |
|---|-------|-----------|
| 1 | Upload Invoice PDF | Muat naik PDF invois; no. invois + tarikh bayaran dimasukkan manual |
| 2 | Pengurusan Cawangan | Tambah cawangan **Pauh Jaya** & **Kelisa Emas** dalam workspace sama |
| 3 | Kawalan Akses Gaji Guru | Gaji & pembayaran guru **hadkan kepada Admin Puan sahaja** |

---

## 1. Upload Invoice PDF

**Permintaan:** Fungsi memuat naik fail PDF invois, manakala nombor invois dan tarikh
bayaran dimasukkan secara manual.

**Keadaan semasa:**
- Tiada modul invois. Rekod bayaran berada dalam `payments` (ledger Payments).
- `payments` ada lajur `reference_number` + `payment_date` + `status` — tapi tiada URL fail.
- Ada `DataImports.tsx` tapi itu untuk CSV/RinggitPay (bulk import), bukan PDF.

**Yang perlu dibina:**
- Storage bucket Supabase (`invoice-pdfs/`) — per tenant, per bayaran.
- Lajur baharu pada `payments`: `invoice_url TEXT`, `invoice_number TEXT`.
- UI pada halaman Payments: butang "Attach PDF", papar link/preview, muat turun semula.
- Validasi: sahkan PDF sahaja, saiz maks (cadangan 5 MB), nama fail `invois-<no>-<tarikh>.pdf`.

**Nota:** Ini kompatibel dengan ledger sedia ada — tiada migrasi besar, cuma tambah lajur.

---

## 2. Pengurusan Cawangan

**Permintaan:** Tambah cawangan **Pauh Jaya** dan **Kelisa Emas** dalam workspace yang
sama, dengan pemilihan cawangan serta pengurusan rekod pelajar dan kelas. **KPI asas
pelajar dan kelas disesuaikan mengikut cawangan.** Perbelanjaan dan laporan kewangan
**masih dikongsi** antara kedua-dua cawangan untuk fasa ini.

**Keadaan semasa:**
- Tiada konsep cawangan langsung. Semua data (students, classes, payments, expenses)
  hanya dikunci pada `business_id`.
- Dashboard KPI: Active Students, Teachers, Active Classes, Monthly Revenue,
  Outstanding Collections — semua agregat per business.

**Yang perlu dibina:**
- Jadual baharu: `branches` (`id`, `business_id`, `name`, `created_at`).
- Lajur `branch_id` pada `customers` (pelajar) dan `groups` (kelas).
- Pemilih cawangan (branch selector) pada Topbar — menapis semua halaman.
- KPI Dashboard + Reports dihitung mengikut branch yang dipilih.
- `expenses` & laporan kewangan **tidak** diubah (kekal agregat business — mengikut
  permintaan "masih dikongsi").
- Seed awal: Pauh Jaya, Kelisa Emas. Data sedia ada → lalai ke Pauh Jaya (cawangan utama).

**Risiko:** Ini perubahan paling besar. Semua query (repositories, dashboard, reports)
perlu sadar `branch_id`. RLS perlu dikemas kini supaya cawangan tidak bocor antara
user dalam business yang sama (untuk sekarang: semua user dalam business nampak semua).

---

## 3. Kawalan Akses Gaji Guru

**Permintaan:** Hadkan akses maklumat gaji dan pembayaran guru kepada akaun **Admin Puan
sahaja**. Staf masih boleh mengurus Expenses dan melihat Net Profit seperti biasa.

**Keadaan semasa:**
- `staff_payments` (bayaran gaji) ada dalam senarai RLS generik —
  `FOR ALL USING (business_id IN user_businesses())`.
  → **Semua user dalam business (termasuk Staff) boleh baca & tulis gaji.**
- Halaman Teachers memaparkan `salary_type` + `salary_amount` kepada **semua orang**
  (gaji bulanan/hourly/commission).
- Tiada halaman khusus "Staff Payments" — gaji hanya dibaca oleh Dashboard untuk
  kiraan Net Profit.
- Role sedia ada: `Creator`, `Admin`, `Staff`, `ReadOnly` (dalam `business_users.role`).
  `isAdmin = role === 'Creator' || role === 'Admin'`.

**Yang perlu dibina:**
- Policy RLS baharu untuk `staff_payments` — sahkan `Admin`/`Creator` boleh akses.
  Policy lama (generik) perlu digantikan, bukan ditambah.
- Sembunyikan `salary_type` / `salary_amount` pada halaman Teachers untuk role bukan Admin.
- Dashboard: staf masih nampak **Net Profit** (angka agregat) — jangan dedahkan
  pecahan gaji di dalam kiraan itu.
- **Soalan:** Adakah Puan Hana nak satu halaman "Staff Payments" (senarai gaji bayar per
  bulan) yang hanya Admin boleh akses? Sekarang belum wujud — perlu dibina dari zero,
  atau cukup sembunyikan yang sedia ada?

**Perhatian:** RLS saja tak cukup — frontend juga mesti menyembunyikan, sebab data yang
far dari API masih mungkin bocor melalui UI/inspect. Keduanya mesti selari.

---

## Soalan Perlu Jawab Sebelum Harga/Scope Disahkan

1. **Fasa / timeline** — tiga-tiganya sekali, atau mana dulu?
2. **Halaman Staff Payments** — perlu dibina halaman baru (senarai gaji per bulan) atau
   cukup sekat akses yang sedia ada?
3. **Cawangan** — Puan Hana sendiri nak tukar-tukar cawangan, atau Khairul urus? (kawalan
   akses untuk cawangan)
4. **Perbelanjaan dikongsi** — kalau laporan dikongsi, bagaimana nak nampak KPI cawangan
   tanpa campur perbelanjaan? Cadangan: Net Profit kekal sebusiness; margin per cawangan
   dikira tanpa tolak belanja.
5. **Bilangan user Staff** — berapa akaun Staff yang aktif, dan adakah mereka semua
   memang tak patut nampak gaji?

---

## Anggaran Usaha (kasar, belum disahkan)

| Modul | Skala | Nota |
|-------|-------|------|
| 1. Invoice PDF | Kecil–Sederhana | Tambah lajur + Storage + UI |
| 2. Cawangan | Besar | Migrasi schema, branch selector, semua query & KPI |
| 3. Akses Gaji | Kecil | Ganti policy RLS + sembunyikan UI |

*Nota: anggaran ini untuk perbincangan sahaja, bukan sebut harga.*
