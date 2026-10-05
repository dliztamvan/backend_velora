
const VERSION = "16.0";
const SESSION_DAYS = 30;

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra }
  });

const cors = (origin = "*") => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization, X-Setup-Key",
  "access-control-max-age": "86400"
});

const out = (data, status = 200, origin = "*") => json(data, status, cors(origin));
const id = (prefix = "id") => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

async function sha256(text) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const salt = crypto.randomUUID();
  return `${salt}:${await sha256(`${salt}:${password}`)}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  return (await sha256(`${salt}:${password}`)) === hash;
}

function cleanUsername(v) {
  return String(v || "").trim().toLowerCase();
}

function validUsername(v) {
  return /^[a-z0-9_.-]{3,30}$/.test(v);
}

function validPhone(v) {
  return /^08\d{8,13}$/.test(v);
}

function getAdminFee(price) {
  const p = Number(price || 0);
  if (p < 20000) return 0;
  if (p < 100000) return 1000;
  if (p < 500000) return 4000;
  if (p < 1000000) return 8000;
  if (p < 3000000) return 12000;
  if (p < 5000000) return 15000;
  if (p < 10000000) return 20000;
  if (p < 25000000) return 30000;
  if (p < 50000000) return 40000;
  if (p < 75000000) return 50000;
  return 75000;
}

const feeRules = [
  [0, 20000, 0], [20000, 100000, 1000], [100000, 500000, 4000],
  [500000, 1000000, 8000], [1000000, 3000000, 12000], [3000000, 5000000, 15000],
  [5000000, 10000000, 20000], [10000000, 25000000, 30000], [25000000, 50000000, 40000],
  [50000000, 75000000, 50000], [75000000, Infinity, 75000]
];

function parseBody(request) {
  return request.json().catch(() => ({}));
}

function tokenFrom(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function auth(request, env) {
  const token = tokenFrom(request);
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires_at > datetime('now')
  `).bind(token).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE users SET online=1,last_seen=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  return row;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, name: u.name, phone: u.phone,
    isAdmin: !!u.is_admin, sellerStatus: u.seller_status,
    sellerUntil: u.seller_until, balance: Number(u.balance || 0), online: !!u.online,
    createdAt: u.created_at
  };
}

async function setting(env, key, fallback = "") {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind(key).first();
  return r?.value ?? fallback;
}

async function settings(env) {
  const sellerPrice = Number(await setting(env, "seller_price", "15000"));
  const sellerDays = Number(await setting(env, "seller_days", "15"));
  return {
    qrisText: await setting(env, "qris_text", "Belum diatur admin"),
    qrisImage: await setting(env, "qris_image", ""),
    sellerPrice, sellerDays, feeRules
  };
}

async function createSession(env, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)")
    .bind(token, userId, expires).run();
  return { token, expiresAt: expires };
}

async function ensureAdminMember(env, conversationId) {
  const admin = await env.DB.prepare("SELECT id FROM users WHERE is_admin=1 ORDER BY created_at LIMIT 1").first();
  if (admin) await env.DB.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) VALUES(?,?)").bind(conversationId, admin.id).run();
}

async function conversationForOrder(env, orderId, buyerId, sellerId) {
  let c = await env.DB.prepare("SELECT * FROM conversations WHERE order_id=? LIMIT 1").bind(orderId).first();
  if (!c) {
    c = { id: id("conv") };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO conversations(id,type,order_id) VALUES(?,?,?)").bind(c.id, "ORDER", orderId),
      env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)").bind(c.id, buyerId),
      env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)").bind(c.id, sellerId)
    ]);
    await ensureAdminMember(env, c.id);
  }
  return c.id;
}

function productRow(r) {
  return {
    id: r.id, sellerId: r.seller_id, sellerUsername: r.seller_username,
    game: r.game, title: r.title, price: Number(r.price), description: r.description || "",
    photos: (() => { try { return JSON.parse(r.photos || "[]"); } catch { return []; } })(),
    status: r.status, createdAt: r.created_at
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      if (path === "/" || path === "/health") {
        return out({ ok: true, service: "Velora Backend", version: VERSION, database: "Cloudflare D1" }, 200, origin);
      }

      if (path === "/config" && method === "GET") {
        return out({ ok: true, ...await settings(env) }, 200, origin);
      }

      if (path === "/fee" && method === "GET") {
        const price = Number(url.searchParams.get("price") || 0);
        return out({ ok: true, price, adminFee: getAdminFee(price), total: price + getAdminFee(price) }, 200, origin);
      }

      if (path === "/auth/register" && method === "POST") {
        const b = await parseBody(request);
        const username = cleanUsername(b.username);
        const phone = String(b.phone || "").trim();
        const password = String(b.password || "");
        const name = String(b.name || username).trim() || username;
        if (!validUsername(username)) return out({ ok:false,error:"Username 3-30 karakter: huruf kecil, angka, titik, garis bawah, atau strip." },400,origin);
        if (!validPhone(phone)) return out({ ok:false,error:"Nomor HP harus diawali 08 dan berisi 10-15 digit." },400,origin);
        if (password.length < 6) return out({ ok:false,error:"Password minimal 6 karakter." },400,origin);
        const exists = await env.DB.prepare("SELECT id FROM users WHERE username=? OR phone=? LIMIT 1").bind(username,phone).first();
        if (exists) return out({ok:false,error:"Username atau nomor HP sudah digunakan."},409,origin);
        const userId = id("usr");
        const passwordHash = await hashPassword(password);
        await env.DB.prepare("INSERT INTO users(id,username,phone,name,password_hash) VALUES(?,?,?,?,?)")
          .bind(userId,username,phone,name,passwordHash).run();
        const session = await createSession(env,userId);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first();
        return out({ok:true,user:publicUser(user),...session},201,origin);
      }

      if (path === "/auth/login" && method === "POST") {
        const b = await parseBody(request);
        const username = cleanUsername(b.username);
        const password = String(b.password || "");
        const user = await env.DB.prepare("SELECT * FROM users WHERE username=? LIMIT 1").bind(username).first();
        if (!user || !(await verifyPassword(password,user.password_hash))) return out({ok:false,error:"Username atau password salah."},401,origin);
        const session = await createSession(env,user.id);
        await env.DB.prepare("UPDATE users SET online=1,last_seen=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
        return out({ok:true,user:publicUser(user),...session,rememberLogin:true},200,origin);
      }

      const me = await auth(request,env);

      if (path === "/auth/logout" && method === "POST") {
        const token = tokenFrom(request);
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
        if (me) await env.DB.prepare("UPDATE users SET online=0 WHERE id=?").bind(me.id).run();
        return out({ok:true},200,origin);
      }

      if (path === "/me" && method === "GET") {
        if (!me) return out({ok:false,error:"Unauthorized"},401,origin);
        return out({ok:true,user:publicUser(me)},200,origin);
      }

      if (path === "/setup/admin" && method === "POST") {
        const key = request.headers.get("X-Setup-Key") || "";
        if (!env.SETUP_KEY || key !== env.SETUP_KEY) return out({ok:false,error:"Setup key salah."},403,origin);
        const b = await parseBody(request);
        const username = cleanUsername(b.username || "admin");
        const phone = String(b.phone || "081234567890");
        const password = String(b.password || "");
        if (password.length < 6) return out({ok:false,error:"Password admin minimal 6 karakter."},400,origin);
        const exists = await env.DB.prepare("SELECT id FROM users WHERE username=? LIMIT 1").bind(username).first();
        if (exists) return out({ok:false,error:"Username admin sudah ada."},409,origin);
        const userId = id("usr");
        await env.DB.prepare("INSERT INTO users(id,username,phone,name,password_hash,is_admin) VALUES(?,?,?,?,?,1)")
          .bind(userId,username,phone,String(b.name || "Admin"),await hashPassword(password)).run();
        return out({ok:true,message:"Admin berhasil dibuat",userId},201,origin);
      }

      if (!me) return out({ok:false,error:"Unauthorized"},401,origin);

      if (path === "/profile" && method === "GET") return out({ok:true,user:publicUser(me)},200,origin);

      if (path === "/profile" && method === "PUT") {
        const b = await parseBody(request);
        const name = String(b.name ?? me.name).trim();
        const phone = String(b.phone ?? me.phone).trim();
        if (!validPhone(phone)) return out({ok:false,error:"Nomor HP tidak valid."},400,origin);
        const duplicate = await env.DB.prepare("SELECT id FROM users WHERE phone=? AND id<>? LIMIT 1").bind(phone,me.id).first();
        if (duplicate) return out({ok:false,error:"Nomor HP sudah digunakan."},409,origin);
        await env.DB.prepare("UPDATE users SET name=?,phone=? WHERE id=?").bind(name,phone,me.id).run();
        return out({ok:true,user:publicUser(await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(me.id).first())},200,origin);
      }

      if (path === "/products" && method === "GET") {
        const game = url.searchParams.get("game");
        const q = url.searchParams.get("q");
        let sql = `SELECT p.*,u.username seller_username FROM products p JOIN users u ON u.id=p.seller_id WHERE p.status='APPROVED'`;
        const binds = [];
        if (game) { sql += " AND LOWER(p.game)=LOWER(?)"; binds.push(game); }
        if (q) { sql += " AND (LOWER(p.title) LIKE LOWER(?) OR LOWER(p.game) LIKE LOWER(?) OR LOWER(COALESCE(p.description,'')) LIKE LOWER(?))"; const x=`%${q}%`; binds.push(x,x,x); }
        sql += " ORDER BY p.created_at DESC";
        const rows = await env.DB.prepare(sql).bind(...binds).all();
        return out({ok:true,products:(rows.results||[]).map(productRow)},200,origin);
      }

      if (path === "/products/" && method === "GET") return out({ok:false,error:"Gunakan /products"},404,origin);

      if (path.startsWith("/products/") && method === "GET") {
        const productId = path.split("/")[2];
        const r = await env.DB.prepare(`SELECT p.*,u.username seller_username FROM products p JOIN users u ON u.id=p.seller_id WHERE p.id=?`).bind(productId).first();
        if (!r) return out({ok:false,error:"Produk tidak ditemukan."},404,origin);
        return out({ok:true,product:productRow(r)},200,origin);
      }

      if (path === "/seller/status" && method === "GET") {
        const price = Number(await setting(env,"seller_price","15000"));
        const days = Number(await setting(env,"seller_days","15"));
        return out({ok:true,sellerStatus:me.seller_status,sellerUntil:me.seller_until,sellerPrice:price,sellerDays:days},200,origin);
      }

      if (path === "/seller/pay" && method === "POST") {
        if (me.is_admin) return out({ok:false,error:"Admin tidak perlu membeli akses seller."},400,origin);
        const b = await parseBody(request);
        const amount = Number(await setting(env,"seller_price","15000"));
        const days = Number(await setting(env,"seller_days","15"));
        const payment = id("sp");
        await env.DB.prepare("INSERT INTO seller_payments(id,user_id,amount,days,method,proof) VALUES(?,?,?,?,?,?)")
          .bind(payment,me.id,amount,days,String(b.method||"QRIS"),String(b.proof||"")).run();
        return out({ok:true,paymentId:payment,amount,days,status:"PENDING"},201,origin);
      }

      if (path === "/seller/listings" && method === "GET") {
        const rows = await env.DB.prepare(`SELECT p.*,u.username seller_username FROM products p JOIN users u ON u.id=p.seller_id WHERE p.seller_id=? ORDER BY p.created_at DESC`).bind(me.id).all();
        return out({ok:true,products:(rows.results||[]).map(productRow)},200,origin);
      }

      if (path === "/seller/products" && method === "POST") {
        if (!me.is_admin && me.seller_status !== "ACTIVE") return out({ok:false,error:"Akun seller belum aktif."},403,origin);
        const b = await parseBody(request);
        const game = String(b.game||"").trim();
        const title = String(b.title||"").trim();
        const price = Number(b.price);
        const description = String(b.description||"");
        const photos = Array.isArray(b.photos) ? b.photos.slice(0,10).map(String) : [];
        if (!game || !title || !Number.isFinite(price) || price <= 0) return out({ok:false,error:"Game, judul, dan harga wajib valid."},400,origin);
        const productId = id("prd");
        await env.DB.prepare("INSERT INTO products(id,seller_id,game,title,price,description,photos,status) VALUES(?,?,?,?,?,?,?,?)")
          .bind(productId,me.id,game,title,Math.round(price),description,JSON.stringify(photos),me.is_admin?"APPROVED":"PENDING").run();
        return out({ok:true,productId,status:me.is_admin?"APPROVED":"PENDING"},201,origin);
      }

      if (path.startsWith("/seller/products/") && method === "PUT") {
        const productId = path.split("/")[3];
        const old = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(productId).first();
        if (!old || (!me.is_admin && old.seller_id !== me.id)) return out({ok:false,error:"Produk tidak ditemukan."},404,origin);
        if (old.status === "SOLD") return out({ok:false,error:"Produk sudah terjual."},400,origin);
        const b = await parseBody(request);
        const game = String(b.game ?? old.game).trim();
        const title = String(b.title ?? old.title).trim();
        const price = Number(b.price ?? old.price);
        const description = String(b.description ?? old.description ?? "");
        const photos = Array.isArray(b.photos) ? b.photos.slice(0,10).map(String) : JSON.parse(old.photos||"[]");
        await env.DB.prepare("UPDATE products SET game=?,title=?,price=?,description=?,photos=? WHERE id=?")
          .bind(game,title,Math.round(price),description,JSON.stringify(photos),productId).run();
        return out({ok:true},200,origin);
      }

      if (path.startsWith("/seller/products/") && method === "DELETE") {
        const productId = path.split("/")[3];
        const p = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(productId).first();
        if (!p || (!me.is_admin && p.seller_id !== me.id)) return out({ok:false,error:"Produk tidak ditemukan."},404,origin);
        if (p.status === "SOLD") return out({ok:false,error:"Produk sudah terjual."},400,origin);
        await env.DB.prepare("DELETE FROM products WHERE id=?").bind(productId).run();
        return out({ok:true},200,origin);
      }

      if (path === "/orders" && method === "GET") {
        const rows = await env.DB.prepare(`SELECT o.*,p.title product_title,bu.username buyer_username,su.username seller_username FROM orders o JOIN products p ON p.id=o.product_id JOIN users bu ON bu.id=o.buyer_id JOIN users su ON su.id=o.seller_id WHERE o.buyer_id=? OR o.seller_id=? ORDER BY o.created_at DESC`).bind(me.id,me.id).all();
        return out({ok:true,orders:rows.results||[]},200,origin);
      }

      if (path === "/orders" && method === "POST") {
        const b = await parseBody(request);
        const productId = String(b.productId||"");
        const product = await env.DB.prepare("SELECT * FROM products WHERE id=? AND status='APPROVED'").bind(productId).first();
        if (!product) return out({ok:false,error:"Produk sudah tidak tersedia."},409,origin);
        if (product.seller_id === me.id) return out({ok:false,error:"Tidak bisa membeli produk sendiri."},400,origin);
        const price = Number(product.price);
        const fee = getAdminFee(price);
        const total = price + fee;
        const orderId = id("ord");
        const convId = id("conv");
        await env.DB.batch([
          env.DB.prepare("UPDATE products SET status='RESERVED' WHERE id=? AND status='APPROVED'").bind(productId),
          env.DB.prepare("INSERT INTO orders(id,buyer_id,seller_id,product_id,price,admin_fee,total,payment_method,status) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE id=? AND status='RESERVED')")
            .bind(orderId,me.id,product.seller_id,productId,price,fee,total,String(b.paymentMethod||"QRIS"),"WAITING_PAYMENT",productId),
          env.DB.prepare("INSERT INTO conversations(id,type,order_id) VALUES(?,?,?)").bind(convId,"ORDER",orderId),
          env.DB.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) VALUES(?,?)").bind(convId,me.id),
          env.DB.prepare("INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) VALUES(?,?)").bind(convId,product.seller_id)
        ]);
        await ensureAdminMember(env,convId);
        return out({ok:true,orderId,price,adminFee:fee,total,status:"WAITING_PAYMENT"},201,origin);
      }

      if (path.startsWith("/orders/") && method === "GET") {
        const orderId = path.split("/")[2];
        const order = await env.DB.prepare(`SELECT o.*,p.title product_title,bu.username buyer_username,su.username seller_username FROM orders o JOIN products p ON p.id=o.product_id JOIN users bu ON bu.id=o.buyer_id JOIN users su ON su.id=o.seller_id WHERE o.id=? AND (o.buyer_id=? OR o.seller_id=? OR ?=1)`).bind(orderId,me.id,me.id,me.is_admin?1:0).first();
        if (!order) return out({ok:false,error:"Order tidak ditemukan."},404,origin);
        return out({ok:true,order},200,origin);
      }

      if (path.startsWith("/orders/") && path.endsWith("/payment") && method === "POST") {
        const orderId = path.split("/")[2];
        const b = await parseBody(request);
        const order = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND buyer_id=?").bind(orderId,me.id).first();
        if (!order) return out({ok:false,error:"Order tidak ditemukan."},404,origin);
        await env.DB.prepare("UPDATE orders SET payment_method=?,payment_proof=?,status='PAYMENT_REVIEW' WHERE id=? AND status IN ('WAITING_PAYMENT','PAYMENT_REVIEW')")
          .bind(String(b.method||order.payment_method||"QRIS"),String(b.proof||""),orderId).run();
        return out({ok:true,status:"PAYMENT_REVIEW"},200,origin);
      }

      if (path.startsWith("/orders/") && path.endsWith("/complete") && method === "POST") {
        const orderId = path.split("/")[2];
        const order = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND buyer_id=?").bind(orderId,me.id).first();
        if (!order) return out({ok:false,error:"Order tidak ditemukan."},404,origin);
        if (order.status !== "PAID" && order.status !== "DELIVERED") return out({ok:false,error:"Order belum bisa diselesaikan."},400,origin);
        await env.DB.batch([
          env.DB.prepare("UPDATE orders SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId),
          env.DB.prepare("UPDATE products SET status='SOLD' WHERE id=?").bind(order.product_id),
          env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(order.price,order.seller_id)
        ]);
        return out({ok:true,status:"COMPLETED"},200,origin);
      }

      if (path === "/chat/conversations" && method === "GET") {
        const rows = await env.DB.prepare(`SELECT c.* FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY c.created_at DESC`).bind(me.id).all();
        return out({ok:true,conversations:rows.results||[]},200,origin);
      }

      if (path.startsWith("/chat/") && path.endsWith("/messages") && method === "GET") {
        const conversationId = path.split("/")[2];
        const member = await env.DB.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(conversationId,me.id).first();
        if (!member && !me.is_admin) return out({ok:false,error:"Akses ditolak."},403,origin);
        const rows = await env.DB.prepare(`SELECT m.*,u.username,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at ASC`).bind(conversationId).all();
        return out({ok:true,messages:rows.results||[]},200,origin);
      }

      if (path.startsWith("/chat/") && path.endsWith("/messages") && method === "POST") {
        const conversationId = path.split("/")[2];
        const member = await env.DB.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(conversationId,me.id).first();
        if (!member && !me.is_admin) return out({ok:false,error:"Akses ditolak."},403,origin);
        const b = await parseBody(request);
        const body = String(b.body||"").trim();
        if (!body) return out({ok:false,error:"Pesan kosong."},400,origin);
        const messageId = id("msg");
        await env.DB.prepare("INSERT INTO messages(id,conversation_id,sender_id,body) VALUES(?,?,?,?)").bind(messageId,conversationId,me.id,body.slice(0,5000)).run();
        return out({ok:true,messageId},201,origin);
      }

      if (path === "/withdrawals" && method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM withdrawals WHERE seller_id=? ORDER BY created_at DESC").bind(me.id).all();
        return out({ok:true,withdrawals:rows.results||[]},200,origin);
      }

      if (path === "/withdrawals" && method === "POST") {
        const b = await parseBody(request);
        const amount = Number(b.amount);
        if (!Number.isInteger(amount) || amount <= 0) return out({ok:false,error:"Nominal tidak valid."},400,origin);
        if (amount > Number(me.balance||0)) return out({ok:false,error:"Saldo tidak cukup."},400,origin);
        const wid = id("wd");
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(amount,me.id,amount),
          env.DB.prepare("INSERT INTO withdrawals(id,seller_id,amount,method,destination) VALUES(?,?,?,?,?)").bind(wid,me.id,amount,String(b.method||"DANA"),String(b.destination||""))
        ]);
        return out({ok:true,withdrawalId:wid,status:"PENDING"},201,origin);
      }

      if (path === "/reports" && method === "POST") {
        const b = await parseBody(request);
        const rid = id("rep");
        await env.DB.prepare("INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details) VALUES(?,?,?,?,?,?)")
          .bind(rid,me.id,String(b.targetType||"PRODUCT"),String(b.targetId||""),String(b.reason||""),String(b.details||"")).run();
        return out({ok:true,reportId:rid},201,origin);
      }

      if (me.is_admin) {
        if (path === "/admin/stats" && method === "GET") {
          const [users,products,orders,pending] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) n FROM users").first(),
            env.DB.prepare("SELECT COUNT(*) n FROM products").first(),
            env.DB.prepare("SELECT COUNT(*) n FROM orders").first(),
            env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('WAITING_PAYMENT','PAYMENT_REVIEW')").first()
          ]);
          return out({ok:true,stats:{users:Number(users?.n||0),products:Number(products?.n||0),orders:Number(orders?.n||0),pendingOrders:Number(pending?.n||0)}},200,origin);
        }

        if (path === "/admin/users" && method === "GET") {
          const rows = await env.DB.prepare("SELECT id,username,phone,name,is_admin,seller_until,seller_status,balance,online,created_at,last_seen FROM users ORDER BY created_at DESC").all();
          return out({ok:true,users:rows.results||[]},200,origin);
        }

        if (path === "/admin/seller-payments" && method === "GET") {
          const rows = await env.DB.prepare(`SELECT sp.*,u.username,u.phone FROM seller_payments sp JOIN users u ON u.id=sp.user_id ORDER BY sp.created_at DESC`).all();
          return out({ok:true,payments:rows.results||[]},200,origin);
        }

        if (path.startsWith("/admin/seller-payments/") && path.endsWith("/approve") && method === "POST") {
          const paymentId = path.split("/")[3];
          const p = await env.DB.prepare("SELECT * FROM seller_payments WHERE id=?").bind(paymentId).first();
          if (!p) return out({ok:false,error:"Pembayaran seller tidak ditemukan."},404,origin);
          const until = new Date(Date.now()+Number(p.days)*86400000).toISOString();
          await env.DB.batch([
            env.DB.prepare("UPDATE seller_payments SET status='APPROVED',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").bind(paymentId),
            env.DB.prepare("UPDATE users SET seller_status='ACTIVE',seller_until=? WHERE id=?").bind(until,p.user_id)
          ]);
          return out({ok:true,status:"APPROVED",sellerUntil:until},200,origin);
        }

        if (path === "/admin/products" && method === "GET") {
          const rows = await env.DB.prepare(`SELECT p.*,u.username seller_username FROM products p JOIN users u ON u.id=p.seller_id ORDER BY p.created_at DESC`).all();
          return out({ok:true,products:(rows.results||[]).map(productRow)},200,origin);
        }

        if (path.startsWith("/admin/products/") && path.endsWith("/approve") && method === "POST") {
          const productId = path.split("/")[3];
          await env.DB.prepare("UPDATE products SET status='APPROVED' WHERE id=? AND status='PENDING'").bind(productId).run();
          return out({ok:true,status:"APPROVED"},200,origin);
        }

        if (path.startsWith("/admin/products/") && method === "DELETE") {
          const productId = path.split("/")[3];
          await env.DB.prepare("DELETE FROM products WHERE id=?").bind(productId).run();
          return out({ok:true},200,origin);
        }

        if (path === "/admin/orders" && method === "GET") {
          const rows = await env.DB.prepare(`SELECT o.*,p.title product_title,bu.username buyer_username,su.username seller_username FROM orders o JOIN products p ON p.id=o.product_id JOIN users bu ON bu.id=o.buyer_id JOIN users su ON su.id=o.seller_id ORDER BY o.created_at DESC`).all();
          return out({ok:true,orders:rows.results||[]},200,origin);
        }

        if (path.startsWith("/admin/orders/") && path.endsWith("/approve-payment") && method === "POST") {
          const orderId = path.split("/")[3];
          const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
          if (!order) return out({ok:false,error:"Order tidak ditemukan."},404,origin);
          await env.DB.prepare("UPDATE orders SET status='PAID',paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='PAYMENT_REVIEW'").bind(orderId).run();
          return out({ok:true,status:"PAID"},200,origin);
        }

        if (path.startsWith("/admin/orders/") && path.endsWith("/delivered") && method === "POST") {
          const orderId = path.split("/")[3];
          await env.DB.prepare("UPDATE orders SET status='DELIVERED' WHERE id=? AND status='PAID'").bind(orderId).run();
          return out({ok:true,status:"DELIVERED"},200,origin);
        }

        if (path === "/admin/withdrawals" && method === "GET") {
          const rows = await env.DB.prepare(`SELECT w.*,u.username,u.phone FROM withdrawals w JOIN users u ON u.id=w.seller_id ORDER BY w.created_at DESC`).all();
          return out({ok:true,withdrawals:rows.results||[]},200,origin);
        }

        if (path.startsWith("/admin/withdrawals/") && path.endsWith("/approve") && method === "POST") {
          const wid = path.split("/")[3];
          await env.DB.prepare("UPDATE withdrawals SET status='APPROVED',reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'").bind(wid).run();
          return out({ok:true,status:"APPROVED"},200,origin);
        }

        if (path === "/admin/reports" && method === "GET") {
          const rows = await env.DB.prepare(`SELECT r.*,u.username reporter_username FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC`).all();
          return out({ok:true,reports:rows.results||[]},200,origin);
        }

        if (path === "/admin/settings" && method === "GET") return out({ok:true,settings:await settings(env)},200,origin);

        if (path === "/admin/settings" && method === "PUT") {
          const b = await parseBody(request);
          const allowed = ["qris_text","qris_image","seller_price","seller_days"];
          const statements = [];
          for (const key of allowed) if (b[key] !== undefined) statements.push(env.DB.prepare("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,String(b[key])));
          if (statements.length) await env.DB.batch(statements);
          return out({ok:true,settings:await settings(env)},200,origin);
        }
      }

      return out({ok:false,error:"Route tidak ditemukan."},404,origin);
    } catch (e) {
      console.error(e);
      return out({ok:false,error:"Server error",detail:String(e?.message||e)},500,origin);
    }
  }
};
