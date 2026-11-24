'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Vercel/other serverless platforms only allow writes in /tmp, so fall back there.
const dataDir = process.env.SNACKTIME_DATA_DIR
  || (process.env.VERCEL ? path.join('/tmp', 'snacktime-data') : path.join(__dirname, '..', 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'snacktime.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL,
    category TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    available INTEGER NOT NULL DEFAULT 1,
    image TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL UNIQUE,
    address TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    method TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    payment_claimed INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL,
    shipping_cost INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT DEFAULT '',
    recipient TEXT DEFAULT '',
    address TEXT DEFAULT '',
    landmark TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    line_total INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    order_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS shipping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    recipient TEXT,
    phone TEXT,
    address TEXT,
    landmark TEXT,
    cost INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'menunggu',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT,
    logo TEXT,
    whatsapp TEXT,
    address TEXT,
    hours TEXT,
    shipping_cost INTEGER,
    bank_name TEXT,
    bank_account TEXT,
    bank_holder TEXT,
    qris_image TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    order_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

/* ------------------------------ helpers ------------------------------ */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const nowIso = () => new Date().toISOString();

/* ------------------------------- seed -------------------------------- */

function seed() {
  const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (productCount === 0) {
    const insert = db.prepare(`INSERT INTO products
      (name, description, price, category, stock, available, image, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const products = [
      ['Keripik Pisang', 'Keripik pisang pilihan yang renyah dengan rasa gurih manis alami, digoreng tipis dan crispy.', 12000, 'Cemilan Gurih', 40, 1, '/images/keripik-pisang.jpg'],
      ['Basreng Pedas', 'Basreng (bakso goreng) renyah berbalut bumbu pedas daun jeruk yang bikin nagih.', 15000, 'Cemilan Pedas', 35, 1, '/images/basreng-pedas.jpg'],
      ['Donat Mini', 'Donat mini lembut dengan aneka topping cokelat dan meses warna-warni, cocok untuk ngemil santai.', 18000, 'Cemilan Manis', 25, 1, '/images/donat-mini.jpg'],
      ['Kentang Goreng', 'Kentang goreng renyah di luar, lembut di dalam, disajikan dengan saus tomat.', 20000, 'Makanan Ringan', 30, 1, '/images/kentang-goreng.jpg'],
      ['Cookies Cokelat', 'Cookies renyah dengan potongan cokelat melimpah, dipanggang fresh setiap hari.', 25000, 'Cemilan Manis', 20, 1, '/images/cookies-cokelat.jpg'],
      ['Cireng Isi', 'Cireng kenyal dengan isian ayam pedas dan keju lumer, digoreng sampai keemasan.', 14000, 'Cemilan Gurih', 42, 1, '/images/cireng-isi.jpg'],
      ['Makaroni Pedas', 'Makaroni pedas gurih dengan bumbu khas SnackTime, pedasnya pas dan bikin ketagihan.', 13000, 'Cemilan Pedas', 50, 1, '/images/makaroni-pedas.jpg'],
      ['Es Teh Lemon', 'Es teh manis segar dengan perasan lemon asli dan es batu, teman terbaik camilan.', 8000, 'Minuman', 60, 1, '/images/es-teh-lemon.jpg'],
      ['Pisang Goreng Keju', 'Pisang goreng hangat dengan topping keju parut dan susu kental manis.', 16000, 'Cemilan Manis', 30, 1, '/images/pisang-goreng-keju.jpg'],
      ['Singkong Keju', 'Singkong goreng empuk dengan taburan keju dan bumbu asin gurih.', 17000, 'Makanan Ringan', 0, 0, '/images/singkong-keju.jpg'],
    ];
    const ts = nowIso();
    for (const p of products) insert.run(...p, ts, ts);
  }

  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admin').get().n;
  if (adminCount === 0) {
    // Demo account ADMIN / ADMIN (stored hashed, never in plain text).
    const { salt, hash } = hashPassword('ADMIN');
    db.prepare('INSERT INTO admin (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)')
      .run('ADMIN', hash, salt, nowIso());
  }

  const settingsCount = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (settingsCount === 0) {
    db.prepare(`INSERT INTO settings
      (id, store_name, logo, whatsapp, address, hours, shipping_cost, bank_name, bank_account, bank_holder, qris_image)
      VALUES (1, ?, '', ?, ?, ?, ?, ?, ?, ?, '')`).run(
      'SnackTime – Cemilan Favoritmu',
      '6281234567890',
      'Jl. Cemilan Rasa No. 17, Kel. Sukamaju, Kec. Ceria, Bandung 40123',
      'Setiap hari, 09.00 – 21.00 WIB',
      10000,
      'BCA',
      '1234567890',
      'SnackTime Indonesia'
    );
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n === 0) seedDemoOrders();
}

function seedDemoOrders() {
  const products = db.prepare('SELECT * FROM products').all();
  const byName = Object.fromEntries(products.map((p) => [p.name, p]));
  const demos = [
    { days: 0, name: 'Rina Putri', wa: '6281234500011', method: 'delivery', pay: 'transfer', status: 'baru', address: 'Jl. Melati No. 8, Bandung', landmark: 'Depan warung Bu Ani', items: [['Basreng Pedas', 2], ['Es Teh Lemon', 2]] },
    { days: 0, name: 'Dimas Aryo', wa: '6281234500022', method: 'pickup', pay: 'qris', status: 'menunggu_pembayaran', items: [['Donat Mini', 1], ['Cookies Cokelat', 1]] },
    { days: 1, name: 'Sari Wulandari', wa: '6281234500033', method: 'dinein', pay: 'cash', status: 'selesai', items: [['Kentang Goreng', 2], ['Es Teh Lemon', 2]] },
    { days: 2, name: 'Bagas Pratama', wa: '6281234500044', method: 'delivery', pay: 'transfer', status: 'selesai', address: 'Jl. Kenanga No. 21, Bandung', landmark: 'Seberang minimarket', items: [['Cireng Isi', 3], ['Makaroni Pedas', 2]] },
    { days: 3, name: 'Nadia Rahma', wa: '6281234500055', method: 'pickup', pay: 'qris', status: 'selesai', items: [['Keripik Pisang', 2], ['Cookies Cokelat', 1]] },
    { days: 4, name: 'Fajar Nugroho', wa: '6281234500066', method: 'delivery', pay: 'cash', status: 'selesai', address: 'Jl. Anggrek No. 3, Bandung', landmark: 'Pagar hijau', items: [['Basreng Pedas', 4], ['Es Teh Lemon', 4]] },
    { days: 6, name: 'Intan Permata', wa: '6281234500077', method: 'dinein', pay: 'cash', status: 'selesai', items: [['Pisang Goreng Keju', 2], ['Es Teh Lemon', 2]] },
    { days: 8, name: 'Yoga Saputra', wa: '6281234500088', method: 'pickup', pay: 'transfer', status: 'selesai', items: [['Makaroni Pedas', 3], ['Donat Mini', 1]] },
    { days: 11, name: 'Maya Sari', wa: '6281234500099', method: 'delivery', pay: 'qris', status: 'selesai', address: 'Jl. Dahlia No. 12, Bandung', landmark: 'Dekat masjid', items: [['Cookies Cokelat', 2], ['Kentang Goreng', 2]] },
    { days: 16, name: 'Rizky Hidayat', wa: '6281234500100', method: 'pickup', pay: 'cash', status: 'selesai', items: [['Cireng Isi', 2], ['Es Teh Lemon', 1]] },
    { days: 21, name: 'Lestari Dewi', wa: '6281234500111', method: 'delivery', pay: 'transfer', status: 'dibatalkan', address: 'Jl. Mawar No. 5, Bandung', landmark: 'Samping laundry', items: [['Keripik Pisang', 1], ['Basreng Pedas', 1]] },
    { days: 27, name: 'Arif Setiawan', wa: '6281234500112', method: 'dinein', pay: 'cash', status: 'selesai', items: [['Kentang Goreng', 3], ['Es Teh Lemon', 3]] },
    { days: 34, name: 'Putri Ayu', wa: '6281234500113', method: 'delivery', pay: 'qris', status: 'selesai', address: 'Jl. Cempaka No. 9, Bandung', landmark: 'Gerbang biru', items: [['Donat Mini', 2], ['Cookies Cokelat', 1]] },
    { days: 41, name: 'Hendra Kurnia', wa: '6281234500114', method: 'pickup', pay: 'transfer', status: 'selesai', items: [['Makaroni Pedas', 2], ['Cireng Isi', 2]] },
    { days: 48, name: 'Siti Aminah', wa: '6281234500115', method: 'delivery', pay: 'cash', status: 'selesai', address: 'Jl. Flamboyan No. 2, Bandung', landmark: 'Depan pos ronda', items: [['Pisang Goreng Keju', 3]] },
    { days: 55, name: 'Bayu Firmansyah', wa: '6281234500116', method: 'pickup', pay: 'qris', status: 'selesai', items: [['Basreng Pedas', 1], ['Es Teh Lemon', 2]] },
  ];

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  let counter = 0;

  for (const d of demos) {
    counter += 1;
    const created = new Date(Date.now() - d.days * 86400000 - (counter % 6) * 3600000);
    const iso = created.toISOString();
    const dayKey = iso.slice(0, 10).replace(/-/g, '');
    const orderNumber = `SNK-${dayKey}-${String(counter).padStart(4, '0')}`;
    const items = d.items.map(([name, qty]) => ({ p: byName[name], qty })).filter((x) => x.p);
    const subtotal = items.reduce((s, i) => s + i.p.price * i.qty, 0);
    const shippingCost = d.method === 'delivery' ? settings.shipping_cost : 0;

    const cust = db.prepare('SELECT id FROM customers WHERE whatsapp = ?').get(d.wa);
    let customerId;
    if (cust) customerId = cust.id;
    else {
      customerId = Number(db.prepare('INSERT INTO customers (name, whatsapp, address, created_at) VALUES (?, ?, ?, ?)')
        .run(d.name, d.wa, d.address || '', iso).lastInsertRowid);
    }

    const paid = ['pembayaran_dikonfirmasi', 'diproses', 'siap_diambil', 'sedang_diantar', 'selesai'].includes(d.status);
    const orderId = Number(db.prepare(`INSERT INTO orders
      (order_number, customer_id, customer_name, whatsapp, method, payment_method, payment_claimed,
       subtotal, shipping_cost, total, status, note, recipient, address, landmark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNumber, customerId, d.name, d.wa, d.method, d.pay, paid ? 1 : 0,
        subtotal, shippingCost, subtotal + shippingCost, d.status, '',
        d.method === 'delivery' ? d.name : '', d.address || '', d.landmark || '', iso, iso).lastInsertRowid);

    for (const it of items) {
      db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)')
        .run(orderId, it.p.id, it.p.name, it.p.price, it.qty, it.p.price * it.qty);
    }

    db.prepare(`INSERT INTO transactions (code, order_id, amount, method, status, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`TRX-${dayKey}-${String(counter).padStart(4, '0')}`, orderId, subtotal + shippingCost, d.pay,
        paid ? 'paid' : (d.status === 'dibatalkan' ? 'cancelled' : 'pending'), paid ? iso : null, iso);

    if (d.method === 'delivery') {
      db.prepare(`INSERT INTO shipping (order_id, recipient, phone, address, landmark, cost, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(orderId, d.name, d.wa, d.address || '', d.landmark || '', shippingCost,
          d.status === 'selesai' ? 'diterima' : 'menunggu', iso);
    }

    if (d.status === 'baru' || d.status === 'menunggu_pembayaran') {
      db.prepare('INSERT INTO notifications (type, message, order_id, is_read, created_at) VALUES (?, ?, ?, 0, ?)')
        .run('order', `Pesanan baru ${orderNumber} dari ${d.name}`, orderId, iso);
    }
  }
}

seed();

module.exports = { db, hashPassword, verifyPassword, nowIso };
