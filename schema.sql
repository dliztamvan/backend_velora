PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 username TEXT UNIQUE,
 email TEXT UNIQUE,
 phone TEXT UNIQUE,
 name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 is_admin INTEGER NOT NULL DEFAULT 0,
 seller_until TEXT,
 seller_status TEXT NOT NULL DEFAULT 'NONE',
 balance INTEGER NOT NULL DEFAULT 0,
 online INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seller_payments (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 amount INTEGER NOT NULL DEFAULT 15000,
 days INTEGER NOT NULL DEFAULT 15,
 method TEXT NOT NULL,
 proof TEXT,
 status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY,
 seller_id TEXT NOT NULL,
 game TEXT NOT NULL,
 title TEXT NOT NULL,
 price INTEGER NOT NULL,
 description TEXT,
 photos TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 buyer_id TEXT NOT NULL,
 seller_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 price INTEGER NOT NULL,
 admin_fee INTEGER NOT NULL DEFAULT 0,
 total INTEGER NOT NULL,
 payment_method TEXT,
 payment_proof TEXT,
 status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_at TEXT,
 completed_at TEXT,
 FOREIGN KEY(buyer_id) REFERENCES users(id),
 FOREIGN KEY(seller_id) REFERENCES users(id),
 FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL DEFAULT 'DIRECT',
 order_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_members (
 conversation_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 PRIMARY KEY(conversation_id,user_id),
 FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL,
 sender_id TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 read_at TEXT,
 FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS withdrawals (
 id TEXT PRIMARY KEY,
 seller_id TEXT NOT NULL,
 amount INTEGER NOT NULL,
 method TEXT NOT NULL,
 destination TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(seller_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY,
 reporter_id TEXT NOT NULL,
 target_type TEXT NOT NULL,
 target_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 details TEXT,
 status TEXT NOT NULL DEFAULT 'OPEN',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT,
 FOREIGN KEY(reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id,created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id,created_at);

INSERT OR IGNORE INTO app_settings(key,value) VALUES ('qris_text','Belum diatur admin');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('qris_image','');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('seller_price','15000');
INSERT OR IGNORE INTO app_settings(key,value) VALUES ('seller_days','15');
