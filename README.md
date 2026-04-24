# TG Auto System — README

# 🤖 Telegram Multi-Account Automation System

Sistem distribusi pesan Telegram multi-akun yang terstruktur. Mendukung 20–30 akun Telegram aktif, distribusi pesan ke banyak grup, template message dengan variabel, campaign scheduler, dan admin dashboard real-time.

---

## ✅ Fitur Utama

- **Multi Account Manager** — Login via nomor telepon + OTP (MTProto user session)
- **Group Management** — Manual input + auto-detect dari akun yang sudah join
- **Distribution Engine** — Distribusi grup ke akun secara balanced (round-robin)
- **Template System** — Template teks dengan variabel `{name}`, `{date}`, `{promo}`, dll
- **Campaign Engine** — Jalankan campaign paralel/sequential dengan delay konfigurabel
- **Anti-Detection Layer** — Random delay, typing simulation, daily limit per akun
- **FloodWait Handler** — Auto-pause + retry saat kena rate limit Telegram
- **Admin Dashboard** — SPA web dashboard dengan live log via WebSocket
- **SQLite Database** — Gratis, zero config, portable

---

## 📋 Prasyarat

- Python 3.11+
- Telegram API ID & Hash dari [my.telegram.org](https://my.telegram.org)
- Akun Telegram aktif (nomor telepon)

---

## 🚀 Cara Install & Jalankan

### 1. Clone / Download Project
```
telegram-auto-system/
```

### 2. Buat Virtual Environment
```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Setup Environment Variables
```bash
copy .env.example .env
```
Edit file `.env`:
```env
TELEGRAM_API_ID=12345678          # Dari my.telegram.org
TELEGRAM_API_HASH=abcdef...       # Dari my.telegram.org
SECRET_KEY=your-random-secret     # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### 5. Generate SECRET_KEY
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Salin output ke `SECRET_KEY` di `.env`.

### 6. Jalankan Server
```bash
python run.py
```
Atau:
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 7. Buka Dashboard
Browser: **http://localhost:8000**

Login dengan username/password dari `.env` (default: `admin` / `admin123`)

---

## 📖 Cara Penggunaan

### Step 1: Dapatkan API Credentials
1. Buka https://my.telegram.org
2. Login dengan nomor telepon
3. Klik **API development tools**
4. Buat aplikasi baru → catat `api_id` dan `api_hash`
5. Isi ke file `.env`

### Step 2: Tambah Akun Telegram
1. Dashboard → **Akun Telegram** → **+ Tambah Akun**
2. Masukkan nomor telepon (format: `+6281234567890`)
3. Klik **Kirim Kode OTP**
4. Buka Telegram → cek pesan kode OTP
5. Masukkan kode → **Verifikasi**
6. Akun muncul di dashboard → klik **Connect**

### Step 3: Tambah Grup Target
**Cara A — Auto Detect:**
1. Pastikan akun sudah **Connect**
2. Klik **🔍 Detect Grup** di kartu akun
3. Pilih grup yang ingin ditambahkan → **Import**

**Cara B — Manual:**
1. Dashboard → **Grup Target** → **+ Tambah Grup**
2. Masukkan Telegram Group ID (contoh: `-1001234567890`)
3. Isi nama grup → Simpan

### Step 4: Buat Template Pesan
1. Dashboard → **Template Pesan** → **+ Buat Template**
2. Isi nama & isi pesan
3. Gunakan variabel: `{name}`, `{date}`, `{promo}`, `{custom_text}`
4. Upload gambar jika perlu (dengan caption = isi pesan)
5. **Preview** untuk lihat hasil

### Step 5: Jalankan Campaign
1. Dashboard → **Campaign Manager** → **+ Buat Campaign**
2. Pilih template & grup target
3. Isi nilai variabel (misal: `{promo}` = "DISC50")
4. Setting delay (5–20 detik direkomendasikan)
5. Toggle **Mode Paralel** = semua akun jalan bersamaan
6. Toggle **Anti Duplicate** = 1 grup hanya dari 1 akun
7. Klik **Simpan** → **▶ Mulai**

---

## ⚙️ Konfigurasi Penting

| Setting | Default | Keterangan |
|---------|---------|-----------|
| `ADMIN_USERNAME` | admin | Username login dashboard |
| `ADMIN_PASSWORD` | admin123 | Password login dashboard |
| `TELEGRAM_API_ID` | — | **Wajib** dari my.telegram.org |
| `TELEGRAM_API_HASH` | — | **Wajib** dari my.telegram.org |
| `SECRET_KEY` | — | **Wajib** untuk enkripsi session |
| Daily Limit | 50 | Pesan per akun per hari (ubah di kartu akun) |
| Delay Min | 5s | Minimum delay antar grup |
| Delay Max | 20s | Maximum delay antar grup |

---

## 🗄️ Struktur Database

Database SQLite tersimpan di `data/telegram_auto.db`

| Tabel | Isi |
|-------|-----|
| `accounts` | Data akun + session string terenkripsi |
| `groups` | Daftar grup target |
| `account_group_mapping` | Mapping akun → grup |
| `templates` | Template pesan |
| `campaigns` | Campaign + konfigurasi |
| `send_logs` | Log setiap pengiriman |

---

## 📁 Struktur Folder

```
telegram-auto-system/
├── backend/               # FastAPI Python backend
│   ├── main.py            # Entry point
│   ├── config.py          # Konfigurasi dari .env
│   ├── database.py        # SQLAlchemy models
│   ├── routers/           # REST API endpoints
│   │   ├── accounts.py
│   │   ├── groups.py
│   │   ├── templates.py
│   │   ├── campaigns.py
│   │   ├── logs.py
│   │   └── ws.py          # WebSocket real-time
│   ├── services/          # Business logic
│   │   ├── account_manager.py   # Telethon session pool
│   │   ├── campaign_engine.py   # Campaign runner
│   │   ├── distribution.py      # Group distribution
│   │   ├── template_engine.py   # Variable substitution
│   │   └── anti_detection.py    # Human-like behavior
│   └── utils/
│       └── encryption.py  # Session string encryption
├── frontend/              # Web dashboard (HTML/CSS/JS)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
├── data/                  # SQLite database (auto-created)
├── sessions/              # Session cache (gitignored)
├── media/                 # Uploaded media files
├── requirements.txt
├── .env.example
├── run.py
└── README.md
```

---

## ⚠️ Penting & Keamanan

1. **Jangan share file `.env`** — berisi secret key enkripsi session
2. **Jangan share folder `data/`** — berisi session akun Telegram (terenkripsi)
3. **Gunakan delay yang wajar** — minimum 5 detik direkomendasikan
4. **Batasi daily limit** — 30-50 pesan/hari/akun untuk akun baru
5. **Jangan kirim ke grup besar bersamaan** — mulai kecil, scale perlahan

---

## 🐛 Troubleshooting

**Session tidak valid setelah restart:**
→ Hapus akun dari dashboard, login ulang

**FloodWait error terus:**
→ Kurangi jumlah grup per campaign, naikkan delay

**Akun error/banned:**
→ Istirahatkan akun 24 jam, kurangi frekuensi

**Dashboard tidak bisa connect:**
→ Pastikan server berjalan di port 8000, cek firewall

---

## 📡 API Documentation

Buka **http://localhost:8000/api/docs** untuk Swagger UI interaktif.

---

*Built with FastAPI + Telethon + SQLite + Vanilla JS*
