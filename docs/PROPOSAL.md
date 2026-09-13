# ArcReserve — Business Proposal & Arsitektur Sistem

> Disusun 2026-09-09 dari kondisi `main` saat ini. Dokumen ini merangkum `HANDOVER.md`,
> `CLAUDE.md`, `docs/BUSINESS_MODEL.md`, dan `docs/ARCHITECTURE.md` menjadi satu brief yang bisa
> dipakai untuk submission, pitch, atau onboarding cepat. Untuk detail teknis lengkap, rujukan tetap
> dokumen aslinya — file ini adalah ringkasan, bukan pengganti.

## 1. Ringkasan eksekutif

**ArcReserve** adalah protokol yang mengubah pendapatan dari aset dunia nyata (real-world asset /
RWA) — misalnya proyek panel surya atau properti sewa — menjadi token digital yang bisa dibeli,
diperdagangkan, dan diklaim hasilnya oleh investor yang sudah terverifikasi KYC. Demo yang dipakai
adalah **Solar Indonesia 01 (SOLAR01)**.

Tagline produk: **"Real assets. Programmable liquidity."**

Model intinya sederhana: issuer (pemilik aset) menjual token berbasis **klaim atas arus kas**
(bukan kepemilikan aset itu sendiri), investor menerima **60% dari pendapatan kotor** aset secara
berkala, dan investor selalu bisa **keluar (redeem) kapan saja** ke sebuah cadangan dana (reserve)
yang dilindungi secara ketat di kontrak. Issuer wajib mengisi reserve itu sampai penuh (1:1 per
token) menjelang jatuh tempo, mengikuti jadwal yang dipublikasikan onchain dan tidak bisa
diam-diam diubah.

**Status saat ini: hackathon MVP, kualitas produksi.** Semua berjalan di testnet (Anvil, Base
Sepolia, Hedera testnet) dengan stablecoin mock — belum ada dana sungguhan, belum ada investor
sungguhan, belum diaudit. Tapi standar kode, test coverage, dan disiplin arsitektur dibangun setara
proyek produksi, bukan sekadar prototipe demo.

## 2. Masalah bisnis yang ingin diselesaikan

### Dari sisi pemilik aset (issuer)

Pemilik aset produktif skala kecil-menengah (proyek energi terbarukan, properti sewa, dsb) di pasar
berkembang sering kesulitan mengakses modal karena:

- **Proses pendanaan tradisional lambat dan mahal** — butuh perantara institusional, biaya legal
  tinggi, minimum ticket besar yang menyingkirkan investor kecil
- **Tidak ada cara mudah membagi kepemilikan arus kas** ke banyak investor kecil secara transparan
  dan dapat diaudit
- **Kepercayaan investor rendah** tanpa mekanisme jaminan yang jelas dan dapat diverifikasi

### Dari sisi investor

- **RWA tradisional tidak likuid** — begitu uang masuk ke properti/proyek fisik, sulit keluar
  sebelum jatuh tempo
- **Tidak ada transparansi real-time** atas kesehatan keuangan aset yang mereka danai (apakah
  reserve cukup, apakah issuer telat lapor, dsb)
- **Sulit membedakan token "return terjamin" (sering scam) dari klaim arus kas yang jujur dan
  terbatas kemampuannya**

### Yang coba diselesaikan ArcReserve

| Masalah | Solusi ArcReserve |
| --- | --- |
| Investor kecil sulit akses RWA | Token dipecah kecil, minimum beli rendah, permissioned tapi terbuka untuk kelas investor retail |
| Tidak likuid | Exit kapan saja ke reserve onchain di harga `min(NAV, backing)`, plus pasar sekunder di DEX |
| Tidak transparan | Semua pergerakan dana (issuer proceeds, reserve, market allocation, revenue) adalah kategori akuntansi terpisah yang tercatat sebagai event onchain |
| Risiko gagal bayar issuer disembunyikan | Reserve shortfall terdeteksi otomatis dan **tampil onchain**, bukan negosiasi privat — floor harga dijeda naik saat backing tak sehat |
| "Token dengan janji return palsu" | Desain eksplisit menghindari klaim itu: token ini klaim arus kas dengan batas (capped), bukan ekuitas, bukan garansi peg, bukan dividen terjamin — dilabeli jujur di seluruh copy produk |

## 3. Solusi produk — cara kerja singkat

Setiap seri aset (mis. SOLAR01) memiliki:

1. **Token ERC-20 dengan suplai dibatasi (capped)**, dan **permissioned** — hanya wallet yang lolos
   KYC yang bisa memegang/mentransfernya
2. **Vault dengan lima kategori akuntansi terpisah** — proceeds issuer, reserve terproteksi, alokasi
   market-making, pendapatan aset, dan fee protokol — tidak pernah tercampur
3. **Offering** untuk penjualan awal token ke investor
4. **Distributor revenue** yang membagi pendapatan periodik ke pemegang token secara proporsional
5. **Redemption** yang membiarkan investor keluar kapan saja terhadap reserve
6. **ARC Liquidity Engine** — market maker onchain berbasis Uniswap V3 concentrated liquidity, dengan
   pagar pengaman (guard rails) supaya tidak bisa mencetak token sendiri
7. **Empat peran manusia**: issuer, verifier (due diligence & NAV), investor, dan keeper (operator
   likuiditas)

Alur singkatnya: **issuer listing → verifier approve → investor subscribe → issuer setor revenue
berkala → reserve terisi bertahap → floor harga naik bertahap → investor bisa redeem kapan saja
atau trading di DEX → di jatuh tempo, reserve harus penuh 1:1 per token.**

## 4. Model bisnis

### Pemangku kepentingan dan perannya

| Peran | Tanggung jawab |
| --- | --- |
| **Issuer** | Ajukan aset + dokumen legal, tetapkan term sheet, laporkan pendapatan kotor secara berkala, setor bagian revenue yang dijanjikan, penuhi jadwal reserve |
| **Verifier** | Due diligence, approve/reject term sheet, publikasikan & update NAV, bisa suspend/default-kan aset |
| **Investor** | Lolos KYC, subscribe pakai stablecoin, terima token, klaim revenue, redeem atau trading |
| **KYC provider** | Kelola identity registry protokol |
| **Keeper** | Operasikan likuiditas ARC engine (reposisi range, rebalance) |
| **ArcReserve (protokol)** | Admin protokol, transfer agent, ambil fee protokol |

### Bagaimana setiap pihak mendapat nilai (angka demo, raise 100.000 mUSD @ 1.00)

| | Issuer | Investor | Protokol |
| --- | --- | --- | --- |
| **Saat raise (settlement split 65/30/5)** | 65.000 mUSD tunai langsung | Token dengan backing awal ~0,30/token | — |
| **Berkelanjutan (revenue split 60/25/10/5 sehat, atau 40/45/10/5 saat reserve tertinggal)** | 10% dari tiap setoran revenue (operator fee) | 60% (atau 40%) dari tiap setoran revenue, floor harga naik bertahap | 5% dari tiap setoran revenue |
| **Jatuh tempo** | Sisa reserve dikembalikan setelah semua kewajiban lunas | Sampai dengan 1,00/token + akumulasi revenue | — |
| **Risiko turun** | Penarikan proceeds dibekukan kalau reserve tertinggal jadwal; default → trustee eksekusi jaminan | Modal pokok hanya dilindungi sebatas isi reserve; ada cap di NAV | — |

### Sumber pendapatan protokol (ArcReserve sendiri)

- Fee onboarding aset baru
- Fee sukses-raise atas modal yang settled
- **5% dari setiap setoran revenue** (sudah berjalan di kontrak)
- Bagian dari fee likuiditas market yang direalisasi
- Fee penerbitan lanjutan (follow-on issuance)

Prinsip keras: **fee protokol tidak pernah dipotong dari reserve terproteksi** — reserve murni milik
investor.

## 5. Mekanisme ekonomi inti (ringkas)

| Mekanisme | Cara kerja singkat |
| --- | --- |
| **Split hasil penjualan awal** | 65% issuer (tunai) / 30% reserve / 5% alokasi market — sudah berjalan di kontrak (`ISSUER_BPS=6500`, `RESERVE_BPS=3000`, `MARKET_BPS=500`) |
| **Split revenue periodik** | 60% holder / 25% reserve / 10% operator / 5% protokol saat reserve sehat; otomatis bergeser ke 40/45/10/5 saat reserve tertinggal target — dicek live setiap setoran |
| **Reserve schedule (sinking fund)** | Backing naik linear dari ~0,30 → 1,00 mUSD/token sepanjang 3 tahun sampai jatuh tempo; keterlambatan >30 hari memblokir penarikan proceeds issuer |
| **Published floor** | Harga lantai onchain yang hanya bisa naik (ratchet), dibatasi `min(NAV, backing)`, naik satu langkah per pemanggilan `levelUp()` (siapa saja boleh panggil), cooldown 30 menit |
| **Market-making (ARC Engine)** | Uniswap V3-style concentrated liquidity yang didanai hanya dari alokasi market 5% — tidak pernah menyentuh reserve, tidak bisa mint token sendiri |
| **Redemption** | Kapan saja saat aset aktif, harga = `min(NAV, reserve ÷ suplai investor)`, dibatasi limit harian; token dibakar dulu baru dana keluar |

Lima nilai referensi harga (spot pasar, TWAP, NAV terverifikasi, floor level, harga redemption)
**sengaja dijaga terpisah** di seluruh sistem — tidak pernah dicampur menjadi satu angka yang
menyesatkan.

### Apa yang terjadi jika issuer gagal membayar kewajibannya

Jalur kegagalan adalah tangga eskalasi yang dirancang dan ditegakkan onchain — bukan negosiasi
privat:

```text
tertinggal jadwal → grace 30 hari → SHORTFALL (otomatis) → 90 hari → DEFAULT (verifier)
```

| Tahap | Pemicu | Yang terjadi |
| --- | --- | --- |
| **Shortfall** (otomatis) | Backing di bawah jadwal terpublikasi >30 hari | Penarikan proceeds issuer yang tersisa **dibekukan** — tertinggal jadwal lebih dulu merugikan akses issuer ke uangnya sendiri sebelum merugikan investor. Split revenue sudah otomatis condong ke reserve (60/25 → 40/45). Floor berhenti naik (tidak pernah turun), dan statusnya jadi flag onchain yang publik. Investor tetap bisa redeem sepanjang waktu di `min(NAV, backing)`. |
| **Default** (verifier, ≥90 hari shortfall atau peristiwa default legal) | Aset ditandai `Defaulted` | Penerbitan dan operasi market normal berhenti. Verifier menetapkan harga settlement darurat (dibatasi NAV — tidak bisa mengarang nilai), lalu **emergency redemption** dibuka: investor keluar dari isi reserve yang benar-benar ada. |
| **Pemulihan** (offchain, legal) | Trustee mengeksekusi jaminan | Token ini adalah note *berjaminan*: trustee dapat menyita dan menjual aset dasarnya; hasil penjualan mengalir ke reserve dan menaikkan yang diterima setiap holder tersisa. Chain mencatat akuntansinya; pengadilan yang mengeksekusi — struktur yang sama dengan obligasi project finance. |

Contoh angka (demo): issuer berhenti membayar di bulan ke-18 saat jadwal bilang 0,65 tapi reserve
hanya berisi 0,55/token. Setiap yang redeem langsung menerima ~0,55 (dibatasi kuota harian),
ditambah revenue ~18 bulan yang sudah diterima — dan flag shortfall sudah tampil publik sejak
bulan ke-13, bukan baru ketahuan saat jatuh tempo. Sifat yang berguna: exit lebih awal justru
*menaikkan* backing bagi yang bertahan, karena redemption selalu membayar di atau di bawah
backing per token.

Batas kejujurannya: **modal pokok dilindungi persis sebesar isi reserve ditambah jaminan — tidak
lebih, dan produk ini tidak pernah mengklaim lebih.** Dalam lingkup hackathon, trustee dan
jaminan baru berupa hash dokumen di term sheet, belum perjanjian legal yang dieksekusi (lihat §8).

## 6. Arsitektur sistem

### Diagram komponen

```text
                         +----------------------+
                         | Verifier / NAV role  |
                         +----------+-----------+
                                    |
                             NAV dan status
                                    |
+--------------+          +---------v----------+          +----------------+
| Asset issuer |--------->|   AssetRegistry    |<---------| Indexer / API  |
+------+-------+ submit   +---------+----------+  events  +--------+-------+
       |                            |                              |
       | deploy series disetujui    | registry komponen            | reads
       v                            v                              v
+------+-----------------------------------------------------------+------+
|                          AssetFactory                                   |
| token deployer | vault | offering | revenue | redemption | market       |
+------+-------------+-------------+-------------+------------------------+
       |             |             |             |
       v             v             v             v
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
| AssetToken | | AssetVault | | Offering  | | Revenue / Redemption      |
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
       |             ^             |             |
       |             | stablecoin  |             |
       +-------> AssetMarketManager <-------------+
                         |
                  callback terautentikasi
                         |
                         v
                +--------+---------+
                | Pool V3-compatible|
                | asset / mUSD     |
                +------------------+
```

### Lapisan sistem (3 stack)

| Lapisan | Fungsi | Teknologi |
| --- | --- | --- |
| **Contracts** (`contracts/`) | Semua logika keuangan, akuntansi, kepatuhan, redemption, market-making | Solidity (Foundry), ERC-3643-shaped compliance |
| **Backend** (`backend/`) | Indexer event onchain + API baca `/v1` dengan label provenance (`onchain`/`derived`/`mock`) | Node, PostgreSQL, node-pg-migrate |
| **Frontend** (`frontend/`) | Marketplace, halaman aset, panel issuer/verifier/keeper, transaksi wallet | React + Vite, Tailwind, shadcn/ui (dibangun ulang 2026-09-12, D-035; route dan panel wallet sedang di-port) |

### Prinsip arsitektur kunci

- **Satu sistem terisolasi per seri aset** — SOLAR01 dan seri lain tidak berbagi storage
- **Registry sebagai direktori komponen** — semua alamat kontrak resmi ditemukan lewat registry,
  bukan input sembarangan
- **Akuntansi berkategori, bukan satu kas besar** — lima kategori dana di vault tidak pernah campur
- **Issuance terpisah dari market-making** — hanya offering yang boleh mint, market manager tidak
  pernah bisa mencetak token
- **Referensi nilai independen** — NAV (verifier), spot/TWAP (pool), floor & redemption (reserve) —
  dibandingkan, tidak pernah disatukan
- **Operasi market dapat diamati & dipulihkan** — siklus keeper eksplisit: hapus posisi lama →
  verifikasi keamanan → update range → mint ulang

### Batas kepercayaan (trust boundaries)

| Pihak | Dipercaya untuk | Tidak bisa |
| --- | --- | --- |
| Verifier | Evaluasi bukti, publikasi NAV/status yang jujur | — |
| Admin protokol | Kelola role, exclusion, pause, kebijakan keamanan (single key di demo) | — |
| Keeper | Pilih range, tarik alokasi market, tambah/kurangi likuiditas | Mint lewat manager, debit reserve terproteksi |
| Issuer | Ajukan aset, setor reserve/revenue, tarik proceeds miliknya | Debit reserve terproteksi langsung |
| Frontend/backend | Baca & tampilkan data, sign lewat wallet user | Bypass role kontrak; backend tidak pegang signing key |

## 7. Status implementasi — sudah vs belum

### ✅ Sudah terimplementasi & teruji

**Contracts** (247 test lolos, 20 test suite termasuk invariant):
- Token ERC-20 capped supply dengan compliance permissioned penuh (identity registry, modular
  compliance, freeze, forced transfer)
- Vault dengan 5 kategori akuntansi terpisah + solvency check otomatis
- Offering pembelian langsung (mint instan) dengan batas kelas investor, cap raise, cap per-wallet
- Split hasil penjualan 65/30/5 (issuer/reserve/market)
- Revenue distributor dengan split dinamis 60/25/10/5 ↔ 40/45/10/5, akumulator per-token,
  yield-exclusion untuk vesting
- Redemption reserve-limited (`min(NAV, backing)`), burn-before-pay
- Reserve-yield hook, jadwal sinking-fund dengan enforcement shortfall
- Residual return + jendela maturity 90 hari
- `FloorController` — published floor ratchet-only, satu tick per `levelUp()`, cooldown 30 menit
- ARC Liquidity Engine (`AssetMarketManager`) — 4 posisi Uniswap V3-style, slide/sweep/discovery,
  safety layer (spot/TWAP deviation, cooldown, staleness)
- Term-sheet hash binding, full role renunciation factory
- Demo liquidity seeding, canonical `Swap` events dari mock pool

**Backend**:
- Config yang menolak chain non-testnet
- Migrasi database (23 tabel proyeksi)
- Ingestion event single-transaction-per-block, restart-safe cursor, reorg rollback
- API baca `/v1` lengkap dengan provenance envelope, response Zod-validated
- OHLC dari canonical swap + synthetic feed berlabel `mock`

**Frontend**:
- Halaman marketplace & asset page baca data live dari `/v1` dengan badge provenance
- Mode fixture berlabel jelas kalau API tidak dikonfigurasi
- Wallet writes live: beli, klaim, redeem, aksi issuer, aksi verifier, keeper range calls

**Dokumentasi**: lengkap dan aktif dirawat (`DECISIONS.md` D-001–D-032, `DESIGN_RATIONALE.md`,
boundary docs per stack, `AI_COMPREHENSION_CHECK.md`, `USER_FLOWS.md`)

### ⏳ Belum terimplementasi (target/spesifikasi saja)

| Item | Ukuran kerja | Keterangan |
| --- | --- | --- |
| **Escrowed fundraising** (settlement full/partial/failed + refund) | Besar | Sekarang: beli langsung, mint instan, tanpa escrow — gap terbesar antara kontrak dan model bisnis |
| **Frontend: KYC gating** | Kecil, nilai tinggi | Wallet belum verified sekarang cuma dapat raw revert, bukan penjelasan |
| **Migrasi frontend issuer/verifier/engine** dari fixture ke data live | Sedang | Termasuk keeper ticks yang sekarang hardcoded |
| **Deployment ke testnet Base Sepolia & Hedera** | Sedang | Dua unknown perlu diverifikasi dulu: alamat Uniswap V3 factory di Base Sepolia, dan versi EVM Hedera |
| **Frontend test runner (Vitest)** | Kecil | Belum ada sama sekali |
| **Governed issuance headroom** (20.000 token yang belum di-mint) | Besar | Cap ada, controller kebijakan belum ada |
| **Lock-and-earn** | Besar, prioritas rendah | Baru preview UI + aturan bisnis |
| **Company vesting via factory** | Dihapus dari produk (D-031) | Kontrak `CompanyVestingWallet` masih ada tapi tidak dipakai — issuer dibayar tunai, bukan token |
| **Canonical Uniswap V3 pool** (bukan mock) | Sedang-Besar | Sekarang diuji terhadap `MockUniswapV3Pool`, bukan pool asli — perlu fork test / deployment nyata |
| **Multisig/timelock governance** | Sedang | Didokumentasikan, belum dijalankan — masih single admin key per chain |
| **Legal/custody/audit** | Di luar scope hackathon | Perlu badan hukum, lisensi, kustodian, audit — sengaja tidak dikerjakan |

## 8. Batasan & disclaimer (wajib dibaca sebelum submission)

- **Ini bukan produk yang siap produksi.** Semua "institution-grade" flow (KYC, maker-checker,
  term-sheet binding, reserve schedule) adalah **demonstrasi desain**, bukan kepatuhan
  bersertifikat.
- **Belum ada audit keamanan.** Test coverage tinggi bukan pengganti audit.
- **Token bukan ekuitas, bukan judul hukum, bukan return terjamin, bukan peg harga.** Hak yang ada
  hanya sebatas yang ditetapkan di perjanjian note & dokumen jaminan (yang di scope hackathon ini
  masih placeholder/hash saja, bukan dokumen legal sungguhan).
- **Stablecoin yang dipakai adalah mock** (`MockUSD`) di semua target chain — tidak ada dana
  sungguhan yang berpindah.
- Setiap jalan pintas yang diambil demi kecepatan hackathon dilabeli eksplisit di kode
  (`// DEMO:`), UI, dan `docs/DECISIONS.md` — tidak ada yang disembunyikan.

## 9. Rekomendasi urutan kerja berikutnya

1. **KYC gating di frontend** — kecil, dampak besar, langsung menutup gap keamanan yang paling
   kentara ke juri/pengguna
2. **Deployment ke testnet Base Sepolia & Hedera** — buka jalan ke integrasi Uniswap Foundation &
   Hedera secara nyata (bukan cuma di Anvil lokal)
3. **Migrasi sisa frontend** (issuer/verifier/engine) dari fixture ke data live
4. **Escrowed fundraising** — gap struktural terbesar antara kontrak dan model bisnis yang
   didokumentasikan
5. Sisanya: headroom issuance, lock-and-earn, governance multisig

---

*Dokumen ini dibuat sebagai ringkasan strategis untuk keperluan proposal/submission. Untuk detail
teknis definitif, rujuk `CLAUDE.md`, `docs/BUSINESS_MODEL.md`, `docs/ARCHITECTURE.md`, dan kode
sumber di `contracts/src/` — kode Solidity yang lolos test selalu menjadi sumber kebenaran utama
jika ada perbedaan dengan dokumen ini.*
