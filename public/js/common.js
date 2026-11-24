/* SNACKTIME – shared customer-side helpers: API, cart, header, footer, toasts */
(function () {
  'use strict';

  const CART_KEY = 'snacktime_cart_v1';
  const CART_META_KEY = 'snacktime_cart_meta_v1';

  const icons = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h2.2l2.6 12.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 2-1.6L21.5 7H5.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
    popcorn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.2 9.6a2.4 2.4 0 0 1-.4-4.5 2.7 2.7 0 0 1 4-2.2A2.6 2.6 0 0 1 12 1.4a2.6 2.6 0 0 1 3.2 1.5 2.7 2.7 0 0 1 4 2.2 2.4 2.4 0 0 1-.4 4.5v.6H5.2v-.6Z"/><path d="M6 11.2h12l-1 8.4a2.4 2.4 0 0 1-2.4 2.1H9.4A2.4 2.4 0 0 1 7 19.6l-1-8.4Zm3.1.9.5 6.5M12 12.1v6.6m2.9-6.6-.5 6.5" stroke="#fff" stroke-width="1.1" stroke-linecap="round" fill="none"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.9 9.9 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.11-.22-.17-.47-.29Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 2h-3v13.2a2.7 2.7 0 1 1-2.2-2.65V9.5a5.9 5.9 0 1 0 5.2 5.86V8.9a6.7 6.7 0 0 0 4 1.32V7.1a3.9 3.9 0 0 1-4-3.9V2Z"/></svg>',
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rupiah(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  }

  function formatDate(iso, withTime = true) {
    if (!iso) return '-';
    const d = new Date(iso);
    const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return withTime ? `${date} • ${time}` : date;
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const isForm = opts.body instanceof FormData;
    opts.headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
    if (opts.body && !isForm && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Terjadi kesalahan (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* --------------------------------- cart -------------------------------- */
  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((i) => i && i.id && i.qty > 0) : [];
    } catch { return []; }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(items.reduce((s, i) => s + i.qty, 0));
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    });
    document.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
  }

  const cart = {
    all: readCart,
    count: () => readCart().reduce((s, i) => s + i.qty, 0),
    subtotal: () => readCart().reduce((s, i) => s + i.price * i.qty, 0),
    add(product, qty = 1) {
      const items = readCart();
      const found = items.find((i) => i.id === product.id);
      const stock = Number(product.stock ?? 99);
      if (product.available === false || stock <= 0) {
        toast('Maaf, produk ini sedang habis.', 'error');
        return false;
      }
      if (found) {
        if (found.qty + qty > stock) {
          toast(`Stok ${product.name} hanya tersisa ${stock}.`, 'error');
          found.qty = stock;
        } else {
          found.qty += qty;
        }
        found.stock = stock;
        found.price = product.price;
      } else {
        items.push({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image,
          stock,
          qty: Math.min(qty, stock),
          available: product.available !== false,
        });
      }
      writeCart(items);
      return true;
    },
    setQty(id, qty) {
      const items = readCart();
      const item = items.find((i) => i.id === id);
      if (!item) return;
      if (qty <= 0) return cart.remove(id);
      item.qty = Math.min(qty, item.stock || 99);
      writeCart(items);
      return item.qty;
    },
    remove(id) {
      writeCart(readCart().filter((i) => i.id !== id));
    },
    clear() { writeCart([]); },
  };

  /* -------------------------------- toast -------------------------------- */
  function toast(message, type = 'info') {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
    el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '!' : 'ℹ'}</span><span>${esc(message)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  /* -------------------------------- header ------------------------------- */
  let settingsCache = null;
  async function getSettings(force = false) {
    if (settingsCache && !force) return settingsCache;
    try {
      settingsCache = await api('/api/settings');
    } catch {
      settingsCache = {
        store_name: 'SnackTime – Cemilan Favoritmu', whatsapp: '6281234567890',
        address: 'Jl. Cemilan Rasa No. 17, Bandung', hours: 'Setiap hari, 09.00 – 21.00 WIB',
        shipping_cost: 10000, bank: { name: 'BCA', account: '1234567890', holder: 'SnackTime Indonesia' }, qris_image: '',
      };
    }
    return settingsCache;
  }

  function navLinks(active) {
    const links = [
      { key: 'home', label: 'Beranda', href: '/index.html' },
      { key: 'menu', label: 'Menu Cemilan', href: '/menu.html' },
      { key: 'about', label: 'Tentang Kami', href: '/index.html#tentang' },
      { key: 'how', label: 'Cara Pesan', href: '/index.html#cara-pesan' },
    ];
    return links.map((l) => `<a href="${l.href}" class="${active === l.key ? 'active' : ''}">${l.label}</a>`).join('');
  }

  function mountHeader(active) {
    const host = document.getElementById('app-header');
    if (!host) return;
    host.innerHTML = `
      <header class="site-header">
        <div class="container header-inner">
          <a class="logo" href="/index.html" aria-label="SnackTime Beranda">
            <span class="logo-mark">${icons.popcorn}</span>
            <span class="logo-text">
              <span class="logo-name">Snack<span>Time</span></span>
              <span class="logo-tag">Cemilan Favoritmu</span>
            </span>
          </a>
          <nav class="site-nav" id="siteNav">${navLinks(active)}</nav>
          <div class="header-actions">
            <button class="cart-btn" id="cartBtn" aria-label="Buka keranjang">
              ${icons.cart}
              <span class="hide-sm">Keranjang</span>
              <span class="cart-count" data-cart-count>0</span>
            </button>
            <button class="nav-toggle" id="navToggle" aria-label="Menu">☰</button>
          </div>
        </div>
      </header>`;

    const overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'drawerOverlay';
    const drawer = document.createElement('aside');
    drawer.className = 'cart-drawer';
    drawer.id = 'cartDrawer';
    drawer.setAttribute('aria-label', 'Keranjang belanja');
    drawer.innerHTML = `
      <div class="drawer-head">
        <h3>${icons.cart} Keranjang</h3>
        <button class="drawer-close" id="closeCart" aria-label="Tutup">✕</button>
      </div>
      <div class="drawer-body" id="cartItems"></div>
      <div class="drawer-foot" id="cartFoot"></div>`;
    document.body.append(overlay, drawer);

    const open = () => {
      drawer.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      renderCartDrawer();
    };
    const close = () => {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    };
    document.getElementById('cartBtn').addEventListener('click', open);
    document.getElementById('closeCart').addEventListener('click', close);
    overlay.addEventListener('click', close);
    document.getElementById('navToggle').addEventListener('click', () => {
      document.getElementById('siteNav').classList.toggle('open');
    });
    drawer.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      const rm = e.target.closest('[data-remove]');
      if (inc) cart.setQty(Number(inc.dataset.inc), (readCart().find((i) => i.id === Number(inc.dataset.inc))?.qty || 0) + 1);
      if (dec) cart.setQty(Number(dec.dataset.dec), (readCart().find((i) => i.id === Number(dec.dataset.dec))?.qty || 0) - 1);
      if (rm) cart.remove(Number(rm.dataset.remove));
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.addEventListener('cart:change', () => {
      if (drawer.classList.contains('open')) renderCartDrawer();
    });
    writeCart(readCart());
    getSettings().then(() => {
      if (drawer.classList.contains('open')) renderCartDrawer();
    });
  }

  function renderCartDrawer() {
    const items = readCart();
    const body = document.getElementById('cartItems');
    const foot = document.getElementById('cartFoot');
    if (!body || !foot) return;
    if (!items.length) {
      body.innerHTML = `<div class="cart-empty">
        <span class="emoji">🍿</span>
        <h4>Keranjangmu masih kosong</h4>
        <p style="font-size:.85rem;margin:6px 0 18px">Yuk pilih cemilan favoritmu dulu.</p>
        <a class="btn btn-primary btn-sm" href="/menu.html" onclick="document.getElementById('closeCart')?.click()">Lihat Menu</a>
      </div>`;
      foot.innerHTML = `<button class="btn btn-primary btn-block" disabled>Lanjut ke Checkout</button>`;
      return;
    }
    body.innerHTML = items.map((i) => `
      <div class="cart-item">
        <img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy">
        <div>
          <h4>${esc(i.name)}</h4>
          <span class="unit">${rupiah(i.price)} / porsi</span>
          <div class="line-total">${rupiah(i.price * i.qty)}</div>
          <button class="remove-btn" data-remove="${i.id}">Hapus</button>
        </div>
        <div class="qty-wrap">
          <div class="qty">
            <button data-dec="${i.id}" aria-label="Kurangi">−</button>
            <span>${i.qty}</span>
            <button data-inc="${i.id}" aria-label="Tambah">+</button>
          </div>
        </div>
      </div>`).join('');

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const shipping = Number(settingsCache?.shipping_cost ?? 0);
    foot.innerHTML = `
      <div class="sum-row"><span>Subtotal produk</span><span>${rupiah(subtotal)}</span></div>
      <div class="sum-row"><span>Ongkos kirim (Pesan Antar)</span><span>${rupiah(shipping)}</span></div>
      <div class="sum-row total"><span>Total</span><span>${rupiah(subtotal + shipping)}</span></div>
      <p class="drawer-note">Gratis ongkir untuk Ambil Sendiri & Makan di Tempat.</p>
      <a class="btn btn-primary btn-block" href="/checkout.html" style="margin-top:12px">Lanjut ke Checkout</a>`;
  }

  function mountFooter() {
    const host = document.getElementById('app-footer');
    if (!host) return;
    getSettings().then((s) => {
      const wa = String(s.whatsapp || '').replace(/\D/g, '');
      host.innerHTML = `
        <footer class="site-footer">
          <div class="container">
            <div class="footer-grid">
              <div>
                <a class="logo" href="/index.html" style="margin-bottom:16px">
                  <span class="logo-mark">${icons.popcorn}</span>
                  <span class="logo-text">
                    <span class="logo-name">Snack<span style="color:#ffd166">Time</span></span>
                    <span class="logo-tag">Cemilan Favoritmu</span>
                  </span>
                </a>
                <p>Menemani waktu santaimu dengan aneka cemilan gurih, manis, dan pedas yang dibuat fresh setiap hari.</p>
                <div class="socials">
                  <a href="https://instagram.com" target="_blank" rel="noopener" aria-label="Instagram">${icons.instagram}</a>
                  <a href="https://tiktok.com" target="_blank" rel="noopener" aria-label="TikTok">${icons.tiktok}</a>
                  <a href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${icons.whatsapp}</a>
                </div>
              </div>
              <div>
                <div class="footer-title">Navigasi</div>
                <ul class="footer-links">
                  <li><a href="/index.html">Beranda</a></li>
                  <li><a href="/menu.html">Menu Cemilan</a></li>
                  <li><a href="/index.html#tentang">Tentang Kami</a></li>
                  <li><a href="/index.html#cara-pesan">Cara Pesan</a></li>
                  <li><a href="/pesanan.html">Lacak Pesanan</a></li>
                </ul>
              </div>
              <div>
                <div class="footer-title">Layanan</div>
                <ul class="footer-links">
                  <li><a href="/checkout.html">Checkout</a></li>
                  <li><a href="/index.html#cara-pesan">Makan di Tempat</a></li>
                  <li><a href="/index.html#cara-pesan">Ambil Sendiri</a></li>
                  <li><a href="/index.html#cara-pesan">Pesan Antar</a></li>
                  <li><a href="/admin/">Admin Dashboard</a></li>
                </ul>
              </div>
              <div>
                <div class="footer-title">Hubungi Kami</div>
                <div class="footer-contact">
                  <div><strong>Alamat</strong><br>${esc(s.address)}</div>
                  <div><strong>WhatsApp</strong><br>+${esc(wa)}</div>
                  <div><strong>Jam Operasional</strong><br>${esc(s.hours)}</div>
                </div>
              </div>
            </div>
            <div class="footer-bottom">
              <span>© ${new Date().getFullYear()} ${esc(s.store_name)}. Semua hak dilindungi.</span>
              <span>Dibuat dengan ❤ untuk para pecinta cemilan.</span>
            </div>
          </div>
        </footer>`;
    });
  }

  /* ----------------------------- product card ---------------------------- */
  function statusMeta(p) {
    if (p.available && p.stock > 0) return { cls: 'on', text: 'Tersedia' };
    return { cls: 'off', text: 'Habis' };
  }

  function productCard(p) {
    const st = statusMeta(p);
    const soldOut = st.cls === 'off';
    const low = !soldOut && p.stock <= 5;
    return `
      <article class="product-card" data-product="${p.id}">
        <div class="product-media">
          <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.style.display='none'">
          <span class="cat-badge">${esc(p.category)}</span>
          <span class="status-badge ${st.cls}">${st.text}</span>
        </div>
        <div class="product-body">
          <h3>${esc(p.name)}</h3>
          <p class="desc">${esc(p.description)}</p>
          <span class="stock-note ${low ? 'low' : ''}">${soldOut ? 'Stok habis' : `Stok: ${p.stock}`}</span>
          <div class="product-foot">
            <div class="price">${rupiah(p.price)}<span>per porsi</span></div>
            <button class="add-btn" data-add="${p.id}" aria-label="Tambah ${esc(p.name)} ke keranjang" ${soldOut ? 'disabled' : ''}>
              ${soldOut ? '✕' : icons.plus}
            </button>
          </div>
        </div>
      </article>`;
  }

  function bindProductGrid(products) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn) return;
      const id = Number(btn.dataset.add);
      const product = products.find((p) => p.id === id);
      if (!product) return;
      if (cart.add(product)) {
        btn.classList.add('added');
        btn.innerHTML = '✓';
        setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = icons.plus; }, 900);
        toast(`${product.name} ditambahkan ke keranjang`, 'success');
      }
    });
  }

  function statusBadge(status) {
    const map = {
      baru: ['wait', 'Pesanan Baru'],
      menunggu_pembayaran: ['wait', 'Menunggu Pembayaran'],
      pembayaran_dikonfirmasi: ['process', 'Pembayaran Dikonfirmasi'],
      diproses: ['process', 'Sedang Diproses'],
      siap_diambil: ['process', 'Siap Diambil'],
      sedang_diantar: ['process', 'Sedang Diantar'],
      selesai: ['done', 'Selesai'],
      dibatalkan: ['cancel', 'Dibatalkan'],
    };
    const [cls, label] = map[status] || ['wait', status];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  window.ST = {
    api, cart, toast, esc, rupiah, formatDate, icons, getSettings,
    mountHeader, mountFooter, productCard, bindProductGrid, statusBadge, statusMeta,
  };
})();
