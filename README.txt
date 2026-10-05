VELORAGAMES BACKEND - CLOUDFLARE WORKERS + D1

STRUKTUR:
velora_backend/
  deploy.sh
  schema.sql
  worker/
    index.js
    wrangler.toml

1. Buat D1 bernama: velora
2. Login Wrangler:
   npx wrangler login
3. Jalankan dari root:
   bash deploy.sh
4. Setelah Worker berhasil deploy, import schema:
   npx wrangler d1 execute velora --remote --file=schema.sql
5. Buat secret setup admin:
   npx wrangler secret put SETUP_KEY
   Masukkan key rahasia milikmu.

Catatan:
- Tidak ada [vars] di wrangler.toml.
- Harga seller dan masa aktif seller disimpan di tabel app_settings.
- Admin fee dihitung otomatis berdasarkan harga produk di index.js.
- Session login berlaku 30 hari.
- Jangan masukkan SETUP_KEY ke GitHub.
