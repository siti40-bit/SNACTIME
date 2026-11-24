'use strict';
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword, nowIso } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// On Vercel the deployment is read-only; only /tmp can be written at runtime.
const UPLOAD_DIR = process.env.SNACKTIME_UPLOAD_DIR
  || (process.env.VERCEL ? path.join('/tmp', 'snacktime-uploads') : path.join(PUBLIC_DIR, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

/* --------------------------- constants ---------------------------- */

const CATEGORIES = ['Cemilan Gurih', 'Cemilan Manis', 'Cemilan Pedas', 'Makanan Ringan', 'Minuman'];

const METHODS = {
  dinein: 'Makan di Tempat',
  pickup: 'Ambil Sendiri',
  delivery: 'Pesan Antar',
};

const PAYMENTS = {
  cash: 'Tunai saat pesanan diterima',
  transfer: 'Transfer Bank',
  qris: 'QRIS',
};

const STATUSES = {
  baru: 'Pesanan Baru',
  menunggu_pembayaran: 'Menunggu Pembayaran',
  pembayaran_dikonfirmasi: 'Pembayaran Dikonfirmasi',
  diproses: 'Sedang Diproses',
  siap_diambil: 'Siap Diambil',
  sedang_diantar: 'Sedang Diantar',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

const SHIPPING_STATUSES = {
  menunggu: 'Menunggu',
  disiapkan: 'Disiapkan',
  dikirim: 'Sedang Diantar',
  diterima: 'Pesanan Diterima',
};

/* ---------------------------- helpers ----------------------------- */

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const digits = (s) => String(s || '').replace(/\D/g, '');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

function str(value, { field, min = 0, max = 500, required = true }) {
  const v = String(value ?? '').trim();
  if (!v && required) throw new HttpError(400, `${field} wajib diisi.`);
  if (v.length > max) throw new HttpError(400, `${field} terlalu panjang (maksimal ${max} karakter).`);
  if (v.length < min) throw new HttpError(400, `${field} minimal ${min} karakter.`);
  return v;
}

function int(value, { field, min = 0, max = 100000000 }) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} harus berupa angka.`);
  const i = Math.round(n);
  if (i < min || i > max) throw new HttpError(400, `${field} harus antara ${min} dan ${max}.`);
  return i;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* ---------------------------- sessions ---------------------------- */

const COOKIE_NAME = 'snk_session';
const SESSION_HOURS = 12;

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, adminId, expires);
  return token;
}

function currentAdmin(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`SELECT s.token, s.expires_at, a.id, a.username
                          FROM sessions s JOIN admin a ON a.id = s.admin_id
                          WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, token: row.token };
}

function requireAdmin(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Sesi berakhir. Silakan login kembali.' });
  req.admin = admin;
  next();
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/* --------------------------- rate limits -------------------------- */

const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count += 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return b.count <= limit;
}

/* ---------------------------- uploads ----------------------------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(new HttpError(400, 'Format gambar harus JPG, PNG, WEBP, atau GIF.'));
    }
    cb(null, true);
  },
});

const productUpload = upload.single('image');
const settingsUpload = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'qris', maxCount: 1 }]);

/* ------------------------------ data ------------------------------ */

function getSettingsRow() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

function publicSettings() {
  const s = getSettingsRow();
  return {
    store_name: s.store_name,
    logo: s.logo || '',
    whatsapp: s.whatsapp,
    address: s.address,
    hours: s.hours,
    shipping_cost: s.shipping_cost,
    bank: { name: s.bank_name, account: s.bank_account, holder: s.bank_holder },
    qris_image: s.qris_image || '',
    categories: CATEGORIES,
    methods: METHODS,
    payments: PAYMENTS,
    statuses: STATUSES,
  };
}

function productView(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    category: p.category,
    stock: p.stock,
    available: !!p.available && p.stock > 0,
    image: p.image,
  };
}

function orderItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
}

function orderFull(order) {
  const items = orderItems(order.id);
  const trx = db.prepare('SELECT * FROM transactions WHERE order_id = ?').get(order.id);
  const shipping = db.prepare('SELECT * FROM shipping WHERE order_id = ?').get(order.id);
  return {
    ...order,
    method_label: METHODS[order.method] || order.method,
    payment_label: PAYMENTS[order.payment_method] || order.payment_method,
    status_label: STATUSES[order.status] || order.status,
    payment_claimed: !!order.payment_claimed,
    items: items.map((i) => ({ ...i })),
    transaction: trx ? { ...trx } : null,
    shipping: shipping ? { ...shipping, status_label: SHIPPING_STATUSES[shipping.status] || shipping.status } : null,
  };
}

function nextOrderNumber() {
  const day = todayKey();
  const prefix = `SNK-${day}-`;
  const row = db.prepare("SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1").get(`${prefix}%`);
  let seq = row ? Number(String(row.order_number).slice(prefix.length)) + 1 : 1;
  let candidate = `${prefix}${String(seq).padStart(4, '0')}`;
  while (db.prepare('SELECT 1 FROM orders WHERE order_number = ?').get(candidate)) {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(4, '0')}`;
  }
  return candidate;
}

function notify(type, message, orderId = null) {
  db.prepare('INSERT INTO notifications (type, message, order_id, is_read, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(type, message, orderId, nowIso());
}

/* ----------------------------- static ----------------------------- */

// Uploaded files may live outside public/ (e.g. /tmp on serverless), so serve them explicitly.
// /api/uploads/:file is the same handler for Vercel, where /uploads is rewritten here.
function sendUpload(req, res, next) {
  const file = path.basename(String(req.params.file || ''));
  if (!file) return next();
  const target = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(target)) return res.status(404).end();
  res.sendFile(target);
}
app.get('/uploads/:file', sendUpload);
app.get('/api/uploads/:file', sendUpload);

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

/* -------------------------- public API ---------------------------- */

app.get('/api/health', (_req, res) => res.json({ ok: true, time: nowIso() }));

app.get('/api/settings', (_req, res) => res.json(publicSettings()));

app.get('/api/products', (req, res) => {
  const { search = '', category = '', sort = '' } = req.query;
  const clauses = [];
  const params = [];
  if (String(search).trim()) {
    clauses.push('(name LIKE ? OR description LIKE ?)');
    const q = `%${String(search).trim()}%`;
    params.push(q, q);
  }
  if (String(category).trim()) {
    clauses.push('category = ?');
    params.push(String(category).trim());
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sort === 'cheap' ? 'price ASC'
    : sort === 'expensive' ? 'price DESC'
      : sort === 'name' ? 'name ASC'
        : 'id ASC';
  const rows = db.prepare(`SELECT * FROM products ${where} ORDER BY ${order}`).all(...params);
  res.json({ products: rows.map(productView), categories: CATEGORIES });
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Produk tidak ditemukan.');
  res.json(productView(row));
});

/* --------------------------- create order ------------------------- */

app.post('/api/orders', wrap((req, res) => {
  const ip = req.ip || 'anon';
  if (!rateLimit(`order:${ip}`, 30, 60_000)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi sebentar.');

  const body = req.body || {};
  const name = str(body.name, { field: 'Nama pelanggan', min: 2, max: 60 });
  const whatsapp = digits(body.whatsapp);
  if (whatsapp.length < 9 || whatsapp.length > 15) throw new HttpError(400, 'Nomor WhatsApp tidak valid (9–15 digit).');
  const method = String(body.method || '');
  if (!METHODS[method]) throw new HttpError(400, 'Metode pemesanan tidak valid.');
  const payment = String(body.payment_method || '');
  if (!PAYMENTS[payment]) throw new HttpError(400, 'Metode pembayaran tidak valid.');

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw new HttpError(400, 'Keranjang masih kosong.');
  if (rawItems.length > 50) throw new HttpError(400, 'Jumlah jenis produk terlalu banyak.');

  let address = '';
  let landmark = '';
  let recipient = '';
  let note = '';
  if (method === 'delivery') {
    recipient = str(body.recipient, { field: 'Nama penerima', min: 2, max: 60 });
    const phone = digits(body.recipient_phone || body.whatsapp);
    if (phone.length < 9 || phone.length > 15) throw new HttpError(400, 'Nomor WhatsApp penerima tidak valid.');
    address = str(body.address, { field: 'Alamat lengkap', min: 10, max: 300 });
    landmark = str(body.landmark, { field: 'Patokan lokasi', min: 3, max: 150 });
    note = String(body.note || '').trim().slice(0, 300);
  } else {
    note = String(body.note || '').trim().slice(0, 300);
  }

  const settings = getSettingsRow();
  const merged = new Map();
  for (const it of rawItems) {
    const id = Number(it.product_id ?? it.id);
    const qty = Math.round(Number(it.qty));
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Produk pada keranjang tidak valid.');
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) throw new HttpError(400, 'Jumlah produk harus antara 1 dan 99.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }

  const lines = [];
  for (const [id, qty] of merged) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) throw new HttpError(409, 'Ada produk yang sudah tidak tersedia. Muat ulang menu.');
    if (!p.available) throw new HttpError(409, `${p.name} sedang habis. Silakan pilih produk lain.`);
    if (p.stock < qty) throw new HttpError(409, `Stok ${p.name} tersisa ${p.stock}. Kurangi jumlahnya.`);
    lines.push({ product: p, qty });
  }

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const shippingCost = method === 'delivery' ? Number(settings.shipping_cost) || 0 : 0;
  const total = subtotal + shippingCost;
  const now = nowIso();
  const orderNumber = nextOrderNumber();
  const initialStatus = payment === 'cash' ? 'baru' : 'menunggu_pembayaran';

  db.exec('BEGIN IMMEDIATE');
  let orderId;
  try {
    const cust = db.prepare('SELECT * FROM customers WHERE whatsapp = ?').get(whatsapp);
    let customerId;
    if (cust) {
      customerId = cust.id;
      db.prepare('UPDATE customers SET name = ?, address = ? WHERE id = ?')
        .run(name, method === 'delivery' ? address : cust.address || '', customerId);
    } else {
      customerId = Number(db.prepare('INSERT INTO customers (name, whatsapp, address, created_at) VALUES (?, ?, ?, ?)')
        .run(name, whatsapp, method === 'delivery' ? address : '', now).lastInsertRowid);
    }

    orderId = Number(db.prepare(`INSERT INTO orders
      (order_number, customer_id, customer_name, whatsapp, method, payment_method, payment_claimed,
       subtotal, shipping_cost, total, status, note, recipient, address, landmark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNumber, customerId, name, whatsapp, method, payment,
        subtotal, shippingCost, total, initialStatus, note, recipient, address, landmark, now, now).lastInsertRowid);

    for (const l of lines) {
      db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)')
        .run(orderId, l.product.id, l.product.name, l.product.price, l.qty, l.product.price * l.qty);
      const remaining = l.product.stock - l.qty;
      db.prepare('UPDATE products SET stock = ?, available = ?, updated_at = ? WHERE id = ?')
        .run(remaining, remaining > 0 ? l.product.available : 0, now, l.product.id);
    }

    db.prepare(`INSERT INTO transactions (code, order_id, amount, method, status, paid_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', NULL, ?)`)
      .run(`TRX-${todayKey()}-${String(orderId).padStart(4, '0')}`, orderId, total, payment, now);

    if (method === 'delivery') {
      db.prepare(`INSERT INTO shipping (order_id, recipient, phone, address, landmark, cost, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'menunggu', ?)`)
        .run(orderId, recipient, digits(body.recipient_phone || body.whatsapp), address, landmark, shippingCost, now);
    }

    notify('order', `Pesanan baru ${orderNumber} dari ${name} • ${rupiah(total)}`, orderId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json({ order: orderFull(order), settings: publicSettings() });
}));

/* --------------------- customer order tracking -------------------- */

function findCustomerOrder(number, whatsapp) {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(String(number || '').trim().toUpperCase());
  if (!order) throw new HttpError(404, 'Nomor pesanan tidak ditemukan.');
  if (digits(whatsapp) !== digits(order.whatsapp)) throw new HttpError(403, 'Nomor WhatsApp tidak cocok dengan pesanan ini.');
  return order;
}

app.get('/api/orders/:number', (req, res) => {
  const order = findCustomerOrder(req.params.number, req.query.wa);
  res.json({ order: orderFull(order), settings: publicSettings() });
});

app.post('/api/orders/:number/confirm', (req, res) => {
  const order = findCustomerOrder(req.params.number, (req.body || {}).whatsapp);
  if (order.status === 'dibatalkan') throw new HttpError(409, 'Pesanan ini sudah dibatalkan.');
  db.prepare('UPDATE orders SET payment_claimed = 1, updated_at = ? WHERE id = ?').run(nowIso(), order.id);
  notify('payment', `Konfirmasi pembayaran diterima untuk ${order.order_number} — menunggu verifikasi admin.`, order.id);
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json({
    ok: true,
    message: 'Konfirmasi diterima. Admin akan memverifikasi pembayaranmu sebelum status Lunas ditampilkan.',
    order: orderFull(fresh),
  });
});

app.get('/api/orders/:number/status', (req, res) => {
  const order = findCustomerOrder(req.params.number, req.query.wa);
  res.json({ order_number: order.order_number, status: order.status, status_label: STATUSES[order.status], updated_at: order.updated_at });
});

/* ------------------------------ auth ------------------------------ */

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateLimit(`login:${ip}`, 10, 5 * 60_000)) throw new HttpError(429, 'Terlalu banyak percobaan login. Tunggu beberapa menit.');
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  const ok = admin && verifyPassword(password, admin.salt, admin.password_hash);
  if (!ok) throw new HttpError(401, 'Username atau Password Salah');
  const token = createSession(admin.id);
  setSessionCookie(res, token);
  res.json({ ok: true, admin: { id: admin.id, username: admin.username } });
});

app.post('/api/admin/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

app.use('/api/admin', requireAdmin);

/* -------------------------- admin products ------------------------ */

app.get('/api/admin/products', (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.json({ products: rows.map((p) => ({ ...productView(p), created_at: p.created_at })), categories: CATEGORIES });
});

function productPayload(body) {
  const name = str(body.name, { field: 'Nama produk', min: 2, max: 80 });
  const description = str(body.description, { field: 'Deskripsi', min: 5, max: 400 });
  const price = int(body.price, { field: 'Harga', min: 1000, max: 10000000 });
  const category = String(body.category || '');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Kategori tidak valid.');
  const stock = int(body.stock, { field: 'Stok', min: 0, max: 100000 });
  const wantsAvailable = body.available === undefined
    ? true
    : [true, 'true', '1', 1, 'on'].includes(body.available);
  const available = wantsAvailable && stock > 0 ? 1 : 0;
  return { name, description, price, category, stock, available };
}

app.post('/api/admin/products', productUpload, (req, res) => {
  const p = productPayload(req.body || {});
  const image = req.file ? `/uploads/${req.file.filename}` : String((req.body || {}).image || '').trim();
  if (!image) throw new HttpError(400, 'Foto produk wajib diunggah.');
  const now = nowIso();
  const id = Number(db.prepare(`INSERT INTO products (name, description, price, category, stock, available, image, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.name, p.description, p.price, p.category, p.stock, p.available, image, now, now).lastInsertRowid);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json({ product: productView(row) });
});

app.put('/api/admin/products/:id', productUpload, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Produk tidak ditemukan.');
  const p = productPayload(req.body || {});
  const image = req.file ? `/uploads/${req.file.filename}` : (String((req.body || {}).image || '').trim() || existing.image);
  db.prepare(`UPDATE products SET name = ?, description = ?, price = ?, category = ?, stock = ?, available = ?, image = ?, updated_at = ? WHERE id = ?`)
    .run(p.name, p.description, p.price, p.category, p.stock, p.available, image, nowIso(), id);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: productView(row) });
});

app.delete('/api/admin/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Produk tidak ditemukan.');
  const used = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?').get(id).n;
  if (used > 0) {
    // Keep historical orders intact: hide the product instead of hard deleting.
    db.prepare('UPDATE products SET available = 0, stock = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
    return res.json({ ok: true, archived: true, message: 'Produk sudah pernah dipesan, jadi dinonaktifkan agar riwayat pesanan tetap utuh.' });
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true, deleted: true });
});

/* --------------------------- admin orders ------------------------- */

app.get('/api/admin/orders', (req, res) => {
  const { status = '', q = '' } = req.query;
  const clauses = [];
  const params = [];
  if (String(status).trim()) { clauses.push('status = ?'); params.push(String(status).trim()); }
  if (String(q).trim()) {
    clauses.push('(order_number LIKE ? OR customer_name LIKE ? OR whatsapp LIKE ?)');
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC`).all(...params);
  res.json({ orders: rows.map(orderFull), statuses: STATUSES });
});

app.patch('/api/admin/orders/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = String((req.body || {}).status || '');
  if (!STATUSES[status]) throw new HttpError(400, 'Status pesanan tidak valid.');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  if (order.status === status) return res.json({ order: orderFull(order) });

  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);

    if (status === 'pembayaran_dikonfirmasi') {
      db.prepare("UPDATE transactions SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE order_id = ?").run(now, id);
    }
    if (status === 'dibatalkan') {
      const trx = db.prepare('SELECT * FROM transactions WHERE order_id = ?').get(id);
      if (trx && trx.status !== 'paid') db.prepare("UPDATE transactions SET status = 'cancelled' WHERE order_id = ?").run(id);
      if (order.status !== 'dibatalkan') {
        // Return reserved stock when an order is cancelled.
        for (const item of orderItems(id)) {
          if (!item.product_id) continue;
          const p = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
          if (!p) continue;
          const stock = p.stock + item.qty;
          db.prepare('UPDATE products SET stock = ?, available = 1, updated_at = ? WHERE id = ?').run(stock, now, p.id);
        }
      }
    }
    if (order.method === 'delivery') {
      const shippingStatus = status === 'sedang_diantar' ? 'dikirim'
        : status === 'selesai' ? 'diterima'
          : status === 'diproses' || status === 'pembayaran_dikonfirmasi' ? 'disiapkan'
            : null;
      if (shippingStatus) {
        db.prepare('UPDATE shipping SET status = ?, updated_at = ? WHERE order_id = ?').run(shippingStatus, now, id);
      }
    }
    notify('status', `Status pesanan ${order.order_number} diperbarui menjadi "${STATUSES[status]}".`, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  res.json({ order: orderFull(fresh) });
});

/* ------------------------ admin transactions ---------------------- */

app.get('/api/admin/transactions', (req, res) => {
  const { status = '', q = '' } = req.query;
  const clauses = [];
  const params = [];
  if (String(status).trim()) { clauses.push('t.status = ?'); params.push(String(status).trim()); }
  if (String(q).trim()) {
    clauses.push('(t.code LIKE ? OR o.order_number LIKE ? OR o.customer_name LIKE ?)');
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT t.*, o.order_number, o.customer_name, o.status AS order_status, o.payment_method
                            FROM transactions t JOIN orders o ON o.id = t.order_id
                            ${where} ORDER BY t.id DESC`).all(...params);
  res.json({ transactions: rows });
});

app.post('/api/admin/transactions/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  const trx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!trx) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(trx.order_id);
  if (!order) throw new HttpError(404, 'Pesanan untuk transaksi ini tidak ditemukan.');
  if (order.status === 'dibatalkan') throw new HttpError(409, 'Pesanan sudah dibatalkan.');
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE transactions SET status = 'paid', paid_at = ? WHERE id = ?").run(now, id);
    if (['baru', 'menunggu_pembayaran'].includes(order.status)) {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('pembayaran_dikonfirmasi', now, order.id);
    }
    notify('payment', `Pembayaran ${trx.code} (${order.order_number}) telah dikonfirmasi.`, order.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, message: 'Pembayaran berhasil dikonfirmasi.' });
});

/* -------------------------- admin shipping ------------------------ */

app.get('/api/admin/shipping', (_req, res) => {
  const rows = db.prepare(`SELECT s.*, o.order_number, o.customer_name, o.whatsapp, o.total, o.status AS order_status, o.created_at
                            FROM shipping s JOIN orders o ON o.id = s.order_id
                            ORDER BY s.id DESC`).all();
  res.json({ shipping: rows.map((r) => ({ ...r, status_label: SHIPPING_STATUSES[r.status] || r.status })), statuses: SHIPPING_STATUSES });
});

app.patch('/api/admin/shipping/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM shipping WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Data pengiriman tidak ditemukan.');
  const body = req.body || {};
  const now = nowIso();
  let cost = row.cost;
  if (body.cost !== undefined) {
    cost = int(body.cost, { field: 'Biaya pengiriman', min: 0, max: 1000000 });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
    db.prepare('UPDATE orders SET shipping_cost = ?, total = subtotal + ?, updated_at = ? WHERE id = ?').run(cost, cost, now, row.order_id);
    db.prepare('UPDATE transactions SET amount = ? WHERE order_id = ?').run(order.subtotal + cost, row.order_id);
  }
  let status = row.status;
  if (body.status !== undefined) {
    status = String(body.status);
    if (!SHIPPING_STATUSES[status]) throw new HttpError(400, 'Status pengiriman tidak valid.');
  }
  db.prepare('UPDATE shipping SET cost = ?, status = ?, updated_at = ? WHERE id = ?').run(cost, status, now, id);

  if (status === 'dikirim') {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('sedang_diantar', now, row.order_id);
  } else if (status === 'diterima') {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('selesai', now, row.order_id);
  }
  notify('shipping', `Pengiriman untuk pesanan #${row.order_id} diperbarui (${SHIPPING_STATUSES[status]}).`, row.order_id);
  const fresh = db.prepare('SELECT * FROM shipping WHERE id = ?').get(id);
  res.json({ shipping: { ...fresh, status_label: SHIPPING_STATUSES[fresh.status] } });
});

/* --------------------------- notifications ------------------------ */

app.get('/api/admin/notifications', (_req, res) => {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').all();
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0').get().n;
  res.json({ notifications: rows, unread });
});

app.post('/api/admin/notifications/read', (req, res) => {
  const id = Number((req.body || {}).id);
  if (id) db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  else db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
  res.json({ ok: true });
});

/* ----------------------------- summary ---------------------------- */

app.get('/api/admin/summary', (_req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const totalOrders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const statusCount = (s) => db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status = ?').get(s).n;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE status = 'paid'").get().n;
  const today = db.prepare("SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE date(created_at) = date('now') AND status != 'dibatalkan'").get();

  const dailyRows = db.prepare(`SELECT date(created_at) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
                                FROM orders WHERE status != 'dibatalkan' AND date(created_at) >= date('now', '-13 days')
                                GROUP BY day`).all();
  const dailyMap = new Map(dailyRows.map((r) => [r.day, r]));
  const daily = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const row = dailyMap.get(key);
    daily.push({ label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, revenue: row ? row.revenue : 0, orders: row ? row.orders : 0 });
  }

  const monthlyRows = db.prepare(`SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
                                  FROM orders WHERE status != 'dibatalkan' AND date(created_at) >= date('now', '-5 months', 'start of month')
                                  GROUP BY month`).all();
  const monthlyMap = new Map(monthlyRows.map((r) => [r.month, r]));
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthly = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = monthlyMap.get(key);
    monthly.push({ label: `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, revenue: row ? row.revenue : 0, orders: row ? row.orders : 0 });
  }

  const recent = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 6').all();
  const lowStock = db.prepare('SELECT * FROM products WHERE stock <= 5 ORDER BY stock ASC LIMIT 6').all();

  res.json({
    stats: {
      totalProducts,
      totalOrders,
      newOrders: statusCount('baru') + statusCount('menunggu_pembayaran'),
      processing: statusCount('diproses') + statusCount('pembayaran_dikonfirmasi') + statusCount('siap_diambil') + statusCount('sedang_diantar'),
      done: statusCount('selesai'),
      revenue,
      todayRevenue: today.revenue,
      todayOrders: today.orders,
    },
    daily,
    monthly,
    recent: recent.map(orderFull),
    lowStock: lowStock.map(productView),
  });
});

/* ----------------------------- reports ---------------------------- */

app.get('/api/admin/reports', (req, res) => {
  const period = String(req.query.period || 'daily');
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  let from = String(req.query.from || '').trim();
  let to = String(req.query.to || '').trim();
  if (!from || !to) {
    if (period === 'monthly') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      from = iso(start); to = iso(today);
    } else if (period === 'weekly') {
      from = iso(new Date(Date.now() - 6 * 86400000)); to = iso(today);
    } else {
      from = iso(today); to = iso(today);
    }
  }
  if (from > to) throw new HttpError(400, 'Tanggal awal tidak boleh setelah tanggal akhir.');

  const orders = db.prepare(`SELECT * FROM orders WHERE date(created_at) BETWEEN ? AND ? ORDER BY id DESC`).all(from, to);
  const valid = orders.filter((o) => o.status !== 'dibatalkan');
  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const paidRevenue = db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS n FROM transactions t
                                  JOIN orders o ON o.id = t.order_id
                                  WHERE t.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?`).get(from, to).n;

  const series = db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
                             FROM orders WHERE status != 'dibatalkan' AND date(created_at) BETWEEN ? AND ?
                             GROUP BY day ORDER BY day`).all(from, to);

  const topProducts = db.prepare(`SELECT oi.product_name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
                                  FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                  WHERE o.status != 'dibatalkan' AND date(o.created_at) BETWEEN ? AND ?
                                  GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`).all(from, to);

  const transactionCount = db.prepare(`SELECT COUNT(*) AS n FROM transactions t JOIN orders o ON o.id = t.order_id
                                       WHERE date(o.created_at) BETWEEN ? AND ?`).get(from, to).n;

  res.json({
    from, to, period,
    summary: {
      orders: valid.length,
      revenue,
      paidRevenue,
      averageOrder: valid.length ? Math.round(revenue / valid.length) : 0,
      transactionCount,
    },
    series,
    topProducts,
    orders: orders.map(orderFull),
  });
});

/* ---------------------------- settings ---------------------------- */

app.get('/api/admin/settings', (_req, res) => {
  const s = getSettingsRow();
  res.json({ settings: s });
});

app.put('/api/admin/settings', settingsUpload, (req, res) => {
  const current = getSettingsRow();
  const body = req.body || {};
  const storeName = str(body.store_name, { field: 'Nama toko', min: 2, max: 80 });
  const whatsapp = digits(body.whatsapp);
  if (whatsapp.length < 9 || whatsapp.length > 15) throw new HttpError(400, 'Nomor WhatsApp penjual tidak valid.');
  const address = str(body.address, { field: 'Alamat toko', min: 5, max: 300 });
  const hours = str(body.hours, { field: 'Jam operasional', min: 3, max: 120 });
  const shippingCost = int(body.shipping_cost, { field: 'Ongkos pengiriman', min: 0, max: 1000000 });
  const bankName = String(body.bank_name || '').trim().slice(0, 40);
  const bankAccount = String(body.bank_account || '').replace(/[^\d\s-]/g, '').trim().slice(0, 40);
  const bankHolder = String(body.bank_holder || '').trim().slice(0, 80);

  const files = req.files || {};
  const logo = files.logo?.[0] ? `/uploads/${files.logo[0].filename}` : (String(body.logo_existing ?? current.logo ?? ''));
  const qris = files.qris?.[0] ? `/uploads/${files.qris[0].filename}` : (String(body.qris_existing ?? current.qris_image ?? ''));

  db.prepare(`UPDATE settings SET store_name = ?, logo = ?, whatsapp = ?, address = ?, hours = ?, shipping_cost = ?,
              bank_name = ?, bank_account = ?, bank_holder = ?, qris_image = ? WHERE id = 1`)
    .run(storeName, logo, whatsapp, address, hours, shippingCost, bankName, bankAccount, bankHolder, qris);
  res.json({ settings: getSettingsRow() });
});

/* ------------------------------ errors ---------------------------- */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran gambar maksimal 3 MB.' : `Gagal mengunggah gambar: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server.', ...(err.extra || {}) });
});

// Only start a listener when run directly (`npm start`). On Vercel the app is
// imported and wrapped into a single serverless function instead.
let server = null;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`SnackTime berjalan di http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app, server };
