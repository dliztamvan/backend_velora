-- Run this ONCE against the existing Velora D1 created by v13.
-- It preserves existing users, products, orders and messages.
ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN online INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_proof TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN completed_at TEXT;
CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL,destination TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,FOREIGN KEY(seller_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'OPEN',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,FOREIGN KEY(reporter_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('qris_text','Belum diatur admin');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('admin_fee','3000');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('seller_price','15000');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('seller_days','15');

INSERT OR IGNORE INTO app_settings(key,value) VALUES ('qris_image','https://files.catbox.moe/xjce6d.jpg');
