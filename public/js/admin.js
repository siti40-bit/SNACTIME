/* ==========================================================================
   SNACKTIME – Admin dashboard client
   ========================================================================== */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const modalHost = document.getElementById('modalHost');

  const STATUS = {
    baru: 'Pesanan Baru',
    menunggu_pembayaran: 'Menunggu Pembayaran',
    pembayaran_dikonfirmasi: 'Pembayaran Dikonfirmasi',
    diproses: 'Sedang Diproses',
    siap_diambil: 'Siap Diambil',
    sedang_diantar: 'Sedang Diantar',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan',
  };
  const METHOD = { dinein: 'Makan di Tempat', pickup: 'Ambil Sendiri', delivery: 'Pesan Antar' };
  const PAY = { cash: 'Tunai', transfer: 'Transfer Bank', qris: 'QRIS' };
  const SHIP_STATUS = { menunggu: 'Menunggu', disiapkan: 'Disiapkan', dikirim: 'Sedang Diantar', diterima: 'Pesanan Diterima' };
  const TABS = {
    dashboard: ['Dashboard', 'Ringkasan performa toko SnackTime'],
    products: ['Manajemen Produk', 'Tambah, ubah, dan atur stok cemilan'],
    orders: ['Manajemen Pesanan', 'Kelola semua pesanan pelanggan'],
    transactions: ['Manajemen Transaksi', 'Verifikasi pembayaran dan riwayat transaksi'],
    shipping: ['Manajemen Pengiriman', 'Pesanan antar, alamat, dan biaya kirim'],
    reports: ['Laporan Penjualan', 'Rekap penjualan harian, mingguan, dan bulanan'],
    settings: ['Pengaturan Toko', 'Informasi toko, ongkir, dan pembayaran'],
  };

  const state = {
    tab: 'dashboard',
    products: [],
    categories: [],
    orders: [],
    transactions: [],
    shipping: [],
    settings: null,
    summary: null,
    report: null,
    productFilter: { q: '', cat: '' },
    orderFilter: { q: '', status: '' },
    txFilter: { q: '', status: '' },
    reportFilter: { q: '' },
  };

  /* ------------------------------- helpers ------------------------------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const compact = (n) => {
    const v = Number(n || 0);
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' M';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' jt';
    if (v >= 1e3) return Math.round(v / 1e3) + ' rb';
    return String(v);
  };
  const fmtDate = (iso, withTime = true) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    return withTime ? `${date} ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : date;
  };
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  const badgeClass = {
    baru: 'wait', menunggu_pembayaran: 'wait', pembayaran_dikonfirmasi: 'process',
    diproses: 'process', siap_diambil: 'process', sedang_diantar: 'process',
    selesai: 'done', dibatalkan: 'cancel',
  };
  const badge = (status) => `<span class="badge ${badgeClass[status] || 'muted'}">${esc(STATUS[status] || status)}</span>`;
  const payBadge = (status) => {
    const map = { paid: ['paid', 'Lunas'], pending: ['wait', 'Belum Dibayar'], cancelled: ['cancel', 'Dibatalkan'] };
    const [cls, label] = map[status] || ['muted', status];
    return `<span class="badge ${cls}">${label}</span>`;
  };

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const isForm = opts.body instanceof FormData;
    opts.headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
    if (opts.body && !isForm && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401) {
      location.replace('/admin/');
      throw new Error('Sesi berakhir.');
    }
    if (!res.ok) throw new Error((data && data.error) || `Gagal memuat data (${res.status}).`);
    return data;
  }

  function toast(message, type = 'info') {
    let wrap = document.querySelector('.adm-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'adm-toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `adm-toast ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 260);
    }, 3400);
  }

  function openModal(html) {
    modalHost.innerHTML = `<div class="modal-overlay open" id="modalOverlay"><div class="modal">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    const overlay = document.getElementById('modalOverlay');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    modalHost.innerHTML = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escClose);
  }
  window.closeModal = closeModal;

  /* ----------------------------- notifications --------------------------- */
  let lastUnread = 0;
  let notifLoaded = false;

  async function loadNotifications() {
    try {
      const data = await api('/api/admin/notifications');
      const count = document.getElementById('bellCount');
      const pill = document.getElementById('newOrderPill');
      count.textContent = String(data.unread);
      count.classList.toggle('show', data.unread > 0);
      pill.textContent = String(data.unread);
      pill.style.display = data.unread > 0 ? 'inline-block' : 'none';
      document.getElementById('notifList').innerHTML = data.notifications.length
        ? data.notifications.map((n) => `<div class="notif-item ${n.is_read ? '' : 'unread'}">
            <span class="dot"></span>
            <div style="flex:1">${esc(n.message)}<small>${fmtDate(n.created_at)}</small></div>
            ${n.order_id ? `<button class="icon-btn no-print" data-open-order="${n.order_id}" title="Lihat pesanan">›</button>` : ''}
          </div>`).join('')
        : '<div class="notif-empty">Belum ada notifikasi.</div>';

      if (notifLoaded && data.unread > lastUnread) {
        toast('Notifikasi baru: ada pesanan atau pembayaran terbaru.', 'success');
      }
      lastUnread = data.unread;
      notifLoaded = true;
    } catch { /* session errors redirect on their own */ }
  }

  document.getElementById('bellBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notifPanel').classList.toggle('open');
    loadNotifications();
  });
  document.getElementById('notifPanel').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => document.getElementById('notifPanel').classList.remove('open'));
  document.getElementById('markReadBtn').addEventListener('click', async () => {
    await api('/api/admin/notifications/read', { method: 'POST', body: {} });
    lastUnread = 0;
    loadNotifications();
  });
  document.getElementById('notifList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-order]');
    if (!btn) return;
    document.getElementById('notifPanel').classList.remove('open');
    setTab('orders');
  });

  /* --------------------------------- tabs -------------------------------- */
  document.querySelectorAll('.side-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  const renderers = {
    dashboard: renderDashboard,
    products: renderProducts,
    orders: renderOrders,
    transactions: renderTransactions,
    shipping: renderShipping,
    reports: renderReports,
    settings: renderSettings,
  };

  function setTab(tab) {
    if (!TABS[tab]) return;
    state.tab = tab;
    document.querySelectorAll('.side-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('tabTitle').textContent = TABS[tab][0];
    document.getElementById('tabSub').textContent = TABS[tab][1];
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('notifPanel').classList.remove('open');
    view.innerHTML = '<div class="card">Memuat data…</div>';
    renderers[tab]().catch((err) => {
      view.innerHTML = `<div class="card"><p style="color:var(--red)">Gagal memuat data: ${esc(err.message)}</p></div>`;
    });
  }
  window.setTab = setTab;

  /* ------------------------------- dashboard ----------------------------- */
  function statCard(icon, label, value, sub, cls = '') {
    return `<div class="stat-card ${cls}">
      <span class="stat-ico">${icon}</span>
      <div style="min-width:0">
        <div class="label">${label}</div>
        <div class="value ${String(value).length > 11 ? 'sm' : ''}">${value}</div>
        ${sub ? `<div class="trend">${sub}</div>` : ''}
      </div>
    </div>`;
  }

  function barChart(data, valueKey = 'revenue') {
    const max = Math.max(1, ...data.map((d) => Number(d[valueKey] || 0)));
    return `<div class="bars">${data.map((d) => {
      const h = Math.max(3, Math.round((Number(d[valueKey] || 0) / max) * 100));
      return `<div class="bar-col" title="${esc(d.label)}: ${rupiah(d[valueKey])}">
        <div class="bar-track"><div class="bar" style="height:${h}%"></div></div>
        <span>${esc(d.label)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  async function renderDashboard() {
    const d = await api('/api/admin/summary');
    state.summary = d;
    const { stats, daily, monthly, recent, lowStock } = d;

    view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Dashboard SnackTime</h1>
          <p>Selamat datang kembali, Admin! Berikut ringkasan toko hari ini.</p>
        </div>
        <div class="toolbar no-print" style="margin:0">
          <button class="btn btn-ghost btn-sm" id="refreshDash">↻ Perbarui</button>
          <button class="btn btn-primary btn-sm" id="quickOrder">Lihat Pesanan Masuk</button>
        </div>
      </div>

      <div class="stats-grid">
        ${statCard('🍿', 'Total Produk', stats.totalProducts, `${stats.totalProducts} produk terdaftar`)}
        ${statCard('🧾', 'Total Pesanan', stats.totalOrders, 'seluruh waktu')}
        ${statCard('✨', 'Pesanan Baru', stats.newOrders, 'perlu ditangani')}
        ${statCard('⏳', 'Pesanan Diproses', stats.processing, 'sedang berjalan')}
        ${statCard('✅', 'Pesanan Selesai', stats.done, 'transaksi tuntas')}
        ${statCard('💰', 'Total Pendapatan', rupiah(stats.revenue), `Hari ini: ${rupiah(stats.todayRevenue)} · ${stats.todayOrders} pesanan`, 'revenue')}
      </div>

      <div class="chart-grid">
        <div class="card">
          <div class="card-head">
            <div><h3>Grafik Penjualan Harian</h3><div class="sub">14 hari terakhir</div></div>
            <div class="legend"><span><i></i>Pendapatan</span></div>
          </div>
          ${barChart(daily)}
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Penjualan Bulanan</h3><div class="sub">6 bulan terakhir</div></div>
            <div class="legend"><span><i class="alt"></i>Pendapatan</span></div>
          </div>
          ${barChart(monthly)}
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <div><h3>Pesanan Terbaru</h3><div class="sub">6 pesanan terakhir</div></div>
            <button class="btn btn-ghost btn-sm no-print" id="seeAllOrders">Lihat semua →</button>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>No. Pesanan</th><th>Pelanggan</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                ${recent.length ? recent.map((o) => `<tr>
                  <td class="mono">${esc(o.order_number)}<div class="cell-soft">${fmtDate(o.created_at)}</div></td>
                  <td><span class="cell-strong">${esc(o.customer_name)}</span><div class="cell-soft">${esc(o.method_label)}</div></td>
                  <td class="cell-strong">${rupiah(o.total)}</td>
                  <td>${badge(o.status)}</td>
                </tr>`).join('') : '<tr><td colspan="4" class="empty-row">Belum ada pesanan.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>Stok Menipis</h3><div class="sub">Stok ≤ 5 porsi</div></div>
            <button class="btn btn-ghost btn-sm no-print" id="manageStock">Kelola →</button>
          </div>
          ${lowStock.length ? lowStock.map((p) => `
            <div class="low-stock-item">
              <img src="${esc(p.image)}" alt="">
              <div><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.category)}</div></div>
              <span class="stock">${p.stock} porsi</span>
            </div>`).join('') : '<p class="cell-soft">Semua stok aman. 👍</p>'}
          <div style="margin-top:18px;padding-top:16px;border-top:1px dashed var(--line)">
            <div class="cell-soft" style="margin-bottom:8px">Butuh cepat menambah cemilan baru?</div>
            <button class="btn btn-primary btn-sm" id="dashAddProduct">＋ Tambah Produk</button>
          </div>
        </div>
      </div>`;

    document.getElementById('refreshDash').addEventListener('click', () => setTab('dashboard'));
    document.getElementById('quickOrder').addEventListener('click', () => setTab('orders'));
    document.getElementById('seeAllOrders').addEventListener('click', () => setTab('orders'));
    document.getElementById('manageStock').addEventListener('click', () => setTab('products'));
    document.getElementById('dashAddProduct').addEventListener('click', () => { setTab('products'); setTimeout(addProductFlow, 120); });
  }

  /* -------------------------------- products ----------------------------- */
  function categoryOptions(selected) {
    return ['Cemilan Gurih', 'Cemilan Manis', 'Cemilan Pedas', 'Makanan Ringan', 'Minuman']
      .map((c) => `<option value="${esc(c)}" ${selected === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }

  function productRows(products) {
    const filtered = products.filter((p) => {
      const q = state.productFilter.q.toLowerCase();
      const matchQ = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      const matchC = !state.productFilter.cat || p.category === state.productFilter.cat;
      return matchQ && matchC;
    });
    if (!filtered.length) return '<tr><td colspan="7" class="empty-row">Tidak ada produk yang cocok.</td></tr>';
    return filtered.map((p) => `<tr>
      <td><img class="thumb" src="${esc(p.image)}" alt="${esc(p.name)}"></td>
      <td><span class="cell-strong">${esc(p.name)}</span><div class="cell-soft" style="max-width:280px">${esc(p.description)}</div></td>
      <td><span class="badge muted">${esc(p.category)}</span></td>
      <td class="cell-strong">${rupiah(p.price)}</td>
      <td>${p.stock}</td>
      <td>${p.available ? '<span class="badge paid">Tersedia</span>' : '<span class="badge cancel">Habis</span>'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${p.id}" title="Edit produk">✏️</button>
        <button class="icon-btn danger" data-delete="${p.id}" title="Hapus produk">🗑️</button>
      </div></td>
    </tr>`).join('');
  }

  async function renderProducts() {
    const data = await api('/api/admin/products');
    state.products = data.products;
    state.categories = data.categories;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Manajemen Produk</h1><p>${data.products.length} produk terdaftar · perubahan langsung tampil di halaman pelanggan.</p></div>
        <button class="btn btn-primary" id="addProductBtn">＋ Tambah Produk</button>
      </div>
      <div class="card">
        <div class="toolbar">
          <input class="input" id="pSearch" placeholder="Cari nama produk…" style="min-width:240px" value="${esc(state.productFilter.q)}">
          <select class="select" id="pCat">
            <option value="">Semua kategori</option>
            ${state.categories.map((c) => `<option value="${esc(c)}" ${state.productFilter.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          <span class="cell-soft" id="pCount"></span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Foto</th><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody id="productRows">${productRows(state.products)}</tbody>
          </table>
        </div>
      </div>`;

    const update = () => {
      document.getElementById('productRows').innerHTML = productRows(state.products);
    };
    document.getElementById('pSearch').addEventListener('input', (e) => {
      state.productFilter.q = e.target.value.trim();
      update();
    });
    document.getElementById('pCat').addEventListener('change', (e) => {
      state.productFilter.cat = e.target.value;
      update();
    });
    document.getElementById('addProductBtn').addEventListener('click', addProductFlow);
    document.getElementById('productRows').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-delete]');
      if (edit) {
        const product = state.products.find((p) => p.id === Number(edit.dataset.edit));
        if (product) productModal(product);
      }
      if (del) {
        const product = state.products.find((p) => p.id === Number(del.dataset.delete));
        if (!product) return;
        if (!confirm(`Hapus produk "${product.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
        try {
          const res = await api(`/api/admin/products/${product.id}`, { method: 'DELETE' });
          toast(res.message || 'Produk dihapus.', 'success');
          setTab('products');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  function addProductFlow() {
    productModal(null);
  }

  function productModal(product) {
    const isEdit = !!product;
    const img = product?.image || '/images/keripik-pisang.jpg';
    openModal(`
      <div class="modal-head">
        <h2>${isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}</h2>
        <button class="modal-close" type="button" onclick="closeModal()">✕</button>
      </div>
      <form id="productForm">
        <div class="modal-body">
          <div class="form-error" id="pErr"></div>
          <div class="form-grid">
            <div class="field span-2">
              <label>Nama produk</label>
              <input name="name" maxlength="80" required value="${esc(product?.name || '')}" placeholder="Contoh: Keripik Pisang">
            </div>
            <div class="field">
              <label>Harga (Rp)</label>
              <input name="price" type="number" min="1000" step="500" required value="${product?.price ?? ''}" placeholder="12000">
            </div>
            <div class="field">
              <label>Stok</label>
              <input name="stock" type="number" min="0" step="1" required value="${product?.stock ?? 0}">
            </div>
            <div class="field">
              <label>Kategori</label>
              <select name="category">${categoryOptions(product?.category)}</select>
            </div>
            <div class="field">
              <label>Status</label>
              <select name="available">
                <option value="true" ${product && product.available ? 'selected' : ''}>Tersedia</option>
                <option value="false" ${product && !product.available ? 'selected' : ''}>Habis</option>
              </select>
            </div>
            <div class="field span-2">
              <label>Deskripsi singkat</label>
              <textarea name="description" maxlength="400" required placeholder="Jelaskan rasa dan keunggulan produk…">${esc(product?.description || '')}</textarea>
            </div>
            <div class="field span-2">
              <label>Foto produk</label>
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" id="pImage" ${isEdit ? '' : 'required'}>
              <div class="hint">JPG/PNG/WEBP, maksimal 3 MB. ${isEdit ? 'Kosongkan bila tidak ingin mengganti foto.' : ''}</div>
              <img src="${esc(img)}" alt="Pratinjau" class="image-preview" id="pPreview">
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>
          <button class="btn btn-primary" type="submit" id="pSave">${isEdit ? 'Simpan Perubahan' : 'Tambah Produk'}</button>
        </div>
      </form>`);

    document.getElementById('pImage').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) document.getElementById('pPreview').src = URL.createObjectURL(file);
    });

    document.getElementById('productForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const err = document.getElementById('pErr');
      const save = document.getElementById('pSave');
      err.classList.remove('show');
      const fd = new FormData(form);
      if (!fd.get('image') || !fd.get('image').size) fd.delete('image');
      save.disabled = true;
      save.textContent = 'Menyimpan…';
      try {
        await api(isEdit ? `/api/admin/products/${product.id}` : '/api/admin/products', { method: isEdit ? 'PUT' : 'POST', body: fd });
        closeModal();
        toast(isEdit ? 'Produk berhasil diperbarui.' : 'Produk baru berhasil ditambahkan.', 'success');
        setTab('products');
      } catch (error) {
        err.textContent = error.message;
        err.classList.add('show');
        save.disabled = false;
        save.textContent = isEdit ? 'Simpan Perubahan' : 'Tambah Produk';
      }
    });
  }

  /* --------------------------------- orders ------------------------------ */
  function orderRows(orders) {
    const q = state.orderFilter.q.toLowerCase();
    const filtered = orders.filter((o) => {
      const matchS = !state.orderFilter.status || o.status === state.orderFilter.status;
      const matchQ = !q || [o.order_number, o.customer_name, o.whatsapp].join(' ').toLowerCase().includes(q);
      return matchS && matchQ;
    });
    if (!filtered.length) return '<tr><td colspan="8" class="empty-row">Belum ada pesanan untuk filter ini.</td></tr>';
    return filtered.map((o) => `<tr>
      <td class="mono">${esc(o.order_number)}</td>
      <td class="cell-soft" style="white-space:nowrap">${fmtDate(o.created_at)}</td>
      <td>
        <span class="cell-strong">${esc(o.customer_name)}</span>
        <div class="cell-soft">+${esc(o.whatsapp)}</div>
        ${o.method === 'delivery' ? `<div class="cell-soft">📍 ${esc(o.address || '-')}<br>Patokan: ${esc(o.landmark || '-')}</div>` : ''}
      </td>
      <td><div class="cell-list">${o.items.map((i) => `${esc(i.product_name)} ×${i.qty}`).join('<br>')}</div></td>
      <td class="cell-strong" style="white-space:nowrap">${rupiah(o.total)}<div class="cell-soft">${rupiah(o.shipping_cost)} ongkir</div></td>
      <td><div class="cell-soft">${esc(o.method_label)}</div><div class="badge muted" style="margin-top:4px">${esc(PAY[o.payment_method] || o.payment_method)}</div></td>
      <td>${o.transaction ? payBadge(o.transaction.status) : '-'}
        ${o.payment_claimed && o.transaction && o.transaction.status === 'pending' ? '<div class="cell-soft" style="margin-top:4px">Konfirmasi pelanggan ✓</div>' : ''}</td>
      <td>
        <select class="status-select" data-order-status="${o.id}">
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');
  }

  async function renderOrders() {
    const data = await api('/api/admin/orders');
    state.orders = data.orders;
    const counts = Object.keys(STATUS).reduce((acc, s) => ({ ...acc, [s]: data.orders.filter((o) => o.status === s).length }), {});
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Manajemen Pesanan</h1><p>${data.orders.length} pesanan total · perubahan status langsung terlihat oleh pelanggan.</p></div>
        <button class="btn btn-ghost" id="ordersRefresh">↻ Muat ulang</button>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
        ${statCard('✨', 'Pesanan Baru', counts.baru)}
        ${statCard('⏳', 'Menunggu Bayar', counts.menunggu_pembayaran)}
        ${statCard('🍳', 'Diproses', counts.diproses + counts.pembayaran_dikonfirmasi + counts.siap_diambil + counts.sedang_diantar)}
        ${statCard('✅', 'Selesai', counts.selesai)}
      </div>
      <div class="card">
        <div class="toolbar">
          <input class="input" id="oSearch" placeholder="Cari no. pesanan / nama / WhatsApp…" style="min-width:260px">
          <select class="select" id="oStatus">
            <option value="">Semua status</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v} (${counts[k] || 0})</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>No. Pesanan</th><th>Tanggal</th><th>Pelanggan</th><th>Produk</th><th>Total</th><th>Pemesanan &amp; Bayar</th><th>Pembayaran</th><th>Status Pesanan</th></tr></thead>
            <tbody id="orderRows">${orderRows(state.orders)}</tbody>
          </table>
        </div>
      </div>`;

    const update = () => { document.getElementById('orderRows').innerHTML = orderRows(state.orders); };
    document.getElementById('oSearch').addEventListener('input', (e) => { state.orderFilter.q = e.target.value.trim(); update(); });
    document.getElementById('oStatus').addEventListener('change', (e) => { state.orderFilter.status = e.target.value; update(); });
    document.getElementById('ordersRefresh').addEventListener('click', () => setTab('orders'));

    document.getElementById('orderRows').addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-order-status]');
      if (!sel) return;
      const id = Number(sel.dataset.orderStatus);
      const status = sel.value;
      sel.disabled = true;
      try {
        const { order } = await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: { status } });
        const idx = state.orders.findIndex((o) => o.id === id);
        if (idx > -1) state.orders[idx] = order;
        toast(`Status ${order.order_number} diperbarui menjadi ${order.status_label}.`, 'success');
        update();
      } catch (err) {
        toast(err.message, 'error');
        sel.disabled = false;
        sel.value = state.orders.find((o) => o.id === id)?.status || sel.value;
        return;
      }
      sel.disabled = false;
      loadNotifications();
    });
  }

  /* ------------------------------ transactions --------------------------- */
  function txRows(transactions) {
    const q = state.txFilter.q.toLowerCase();
    const filtered = transactions.filter((t) => {
      const matchS = !state.txFilter.status || t.status === state.txFilter.status;
      const matchQ = !q || [t.code, t.order_number, t.customer_name].join(' ').toLowerCase().includes(q);
      return matchS && matchQ;
    });
    if (!filtered.length) return '<tr><td colspan="8" class="empty-row">Belum ada transaksi untuk filter ini.</td></tr>';
    return filtered.map((t) => `<tr>
      <td class="mono">${esc(t.code)}</td>
      <td class="mono">${esc(t.order_number)}</td>
      <td>${esc(t.customer_name)}</td>
      <td class="cell-soft">${fmtDate(t.created_at)}</td>
      <td class="cell-strong">${rupiah(t.amount)}</td>
      <td>${esc(PAY[t.method] || t.method)}</td>
      <td>${payBadge(t.status)}${t.paid_at ? `<div class="cell-soft">${fmtDate(t.paid_at)}</div>` : ''}</td>
      <td>${t.status === 'pending'
        ? `<button class="btn btn-green btn-xs" data-confirm-trx="${t.id}">Konfirmasi</button>`
        : '<span class="cell-soft">Terverifikasi</span>'}</td>
    </tr>`).join('');
  }

  async function renderTransactions() {
    const data = await api('/api/admin/transactions');
    state.transactions = data.transactions;
    const paid = data.transactions.filter((t) => t.status === 'paid').reduce((s, t) => s + t.amount, 0);
    const pending = data.transactions.filter((t) => t.status === 'pending').length;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Manajemen Transaksi</h1><p>Konfirmasi pembayaran pelanggan dan pantau riwayat transaksi.</p></div>
      </div>
      <div class="stats-grid">
        ${statCard('💳', 'Total Transaksi', data.transactions.length)}
        ${statCard('💰', 'Pembayaran Lunas', rupiah(paid))}
        ${statCard('⏳', 'Menunggu Verifikasi', pending, 'perlu dicek')}
      </div>
      <div class="card">
        <div class="toolbar">
          <input class="input" id="tSearch" placeholder="Cari kode transaksi / no. pesanan…" style="min-width:260px">
          <select class="select" id="tStatus">
            <option value="">Semua status</option>
            <option value="pending">Belum Dibayar</option>
            <option value="paid">Lunas</option>
            <option value="cancelled">Dibatalkan</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Kode Transaksi</th><th>No. Pesanan</th><th>Pelanggan</th><th>Tanggal</th><th>Total</th><th>Metode</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody id="txRows">${txRows(state.transactions)}</tbody>
          </table>
        </div>
      </div>`;

    const update = () => { document.getElementById('txRows').innerHTML = txRows(state.transactions); };
    document.getElementById('tSearch').addEventListener('input', (e) => { state.txFilter.q = e.target.value.trim(); update(); });
    document.getElementById('tStatus').addEventListener('change', (e) => { state.txFilter.status = e.target.value; update(); });
    document.getElementById('txRows').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-confirm-trx]');
      if (!btn) return;
      if (!confirm('Konfirmasi bahwa pembayaran ini sudah diterima? Status pesanan akan menjadi "Pembayaran Dikonfirmasi".')) return;
      btn.disabled = true;
      try {
        const res = await api(`/api/admin/transactions/${btn.dataset.confirmTrx}/confirm`, { method: 'POST', body: {} });
        toast(res.message, 'success');
        setTab('transactions');
        loadNotifications();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  /* -------------------------------- shipping ---------------------------- */
  async function renderShipping() {
    const data = await api('/api/admin/shipping');
    state.shipping = data.shipping;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Manajemen Pengiriman</h1><p>${data.shipping.length} pesanan antar terdaftar. Atur biaya kirim dan status pengiriman.</p></div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>No. Pesanan</th><th>Pelanggan</th><th>Alamat Pengiriman</th><th>Biaya Kirim</th><th>Status Pengiriman</th><th>Aksi</th></tr></thead>
            <tbody>
              ${data.shipping.length ? data.shipping.map((s) => `<tr>
                <td class="mono">${esc(s.order_number)}<div class="cell-soft">${fmtDate(s.created_at)}</div></td>
                <td><span class="cell-strong">${esc(s.customer_name)}</span><div class="cell-soft">+${esc(s.whatsapp)}</div></td>
                <td style="max-width:260px"><div class="cell-soft">${esc(s.recipient || s.customer_name)}</div>${esc(s.address || '-')}<div class="cell-soft">Patokan: ${esc(s.landmark || '-')}</div></td>
                <td>
                  <div style="display:flex;gap:6px;align-items:center">
                    <input class="cost-input" type="number" min="0" step="500" value="${s.cost}" data-cost="${s.id}">
                    <button class="icon-btn" data-save-cost="${s.id}" title="Simpan biaya">💾</button>
                  </div>
                </td>
                <td>
                  <select class="status-select" data-ship-status="${s.id}">
                    ${Object.entries(SHIP_STATUS).map(([k, v]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                  </select>
                </td>
                <td>
                  ${s.status !== 'diterima'
                    ? `<button class="btn btn-green btn-xs" data-received="${s.id}">Tandai Diterima</button>`
                    : '<span class="badge paid">Diterima</span>'}
                  <div class="cell-soft" style="margin-top:4px">Total: ${rupiah(s.total)}</div>
                </td>
              </tr>`).join('') : '<tr><td colspan="6" class="empty-row">Belum ada pesanan antar.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    async function patch(id, body, successMessage) {
      try {
        await api(`/api/admin/shipping/${id}`, { method: 'PATCH', body });
        toast(successMessage, 'success');
        setTab('shipping');
      } catch (err) { toast(err.message, 'error'); }
    }

    view.querySelectorAll('[data-save-cost]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.saveCost;
        const input = view.querySelector(`[data-cost="${id}"]`);
        patch(id, { cost: Number(input.value) }, 'Biaya pengiriman diperbarui.');
      });
    });
    view.querySelectorAll('[data-ship-status]').forEach((sel) => {
      sel.addEventListener('change', () => patch(sel.dataset.shipStatus, { status: sel.value }, 'Status pengiriman diperbarui.'));
    });
    view.querySelectorAll('[data-received]').forEach((btn) => {
      btn.addEventListener('click', () => patch(btn.dataset.received, { status: 'diterima' }, 'Pesanan ditandai telah diterima.'));
    });
  }

  /* --------------------------------- reports ---------------------------- */
  function reportDefaults(period) {
    if (period === 'monthly') {
      const now = new Date();
      return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: isoToday() };
    }
    if (period === 'weekly') return { from: isoDaysAgo(6), to: isoToday() };
    return { from: isoToday(), to: isoToday() };
  }

  async function loadReport() {
    const period = document.getElementById('rPeriod').value;
    const from = document.getElementById('rFrom').value;
    const to = document.getElementById('rTo').value;
    const host = document.getElementById('reportBody');
    host.innerHTML = '<p class="cell-soft">Memuat laporan…</p>';
    try {
      const qs = new URLSearchParams({ period, from, to });
      const report = await api(`/api/admin/reports?${qs}`);
      state.report = report;
      renderReportBody(report);
      document.getElementById('rPrint').disabled = false;
      document.getElementById('rCsv').disabled = false;
    } catch (err) {
      host.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  function renderReportBody(report) {
    const host = document.getElementById('reportBody');
    const q = state.reportFilter.q.toLowerCase();
    const orders = report.orders.filter((o) => !q || [o.order_number, o.customer_name, o.status_label].join(' ').toLowerCase().includes(q));
    const maxTop = Math.max(1, ...report.topProducts.map((p) => p.qty));

    host.innerHTML = `
      <div class="report-head">
        <h1>Laporan Penjualan SnackTime</h1>
        <div class="cell-soft">Periode ${fmtDate(report.from, false)} — ${fmtDate(report.to, false)} · Dicetak ${fmtDate(new Date().toISOString())}</div>
      </div>
      <div class="report-summary">
        ${statCard('🧾', 'Jumlah Pesanan', report.summary.orders)}
        ${statCard('💰', 'Total Pendapatan', rupiah(report.summary.revenue))}
        ${statCard('💳', 'Transaksi', report.summary.transactionCount)}
        ${statCard('📊', 'Rata-rata / Pesanan', rupiah(report.summary.averageOrder))}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head"><div><h3>Grafik Penjualan</h3><div class="sub">${esc(report.from)} s/d ${esc(report.to)}</div></div></div>
          ${report.series.length
            ? barChart(report.series.map((s) => ({ label: s.day.slice(8) + '/' + s.day.slice(5, 7), revenue: s.revenue })))
            : '<p class="cell-soft">Belum ada penjualan pada periode ini.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Produk Terlaris</h3><div class="sub">Berdasarkan jumlah terjual</div></div></div>
          ${report.topProducts.length ? report.topProducts.map((p, i) => `
            <div class="top-product">
              <span class="rank">${i + 1}</span>
              <div style="min-width:0">
                <div class="cell-strong">${esc(p.product_name)}</div>
                <div class="bar-mini" style="width:${Math.max(6, Math.round(p.qty / maxTop * 100))}%"></div>
              </div>
              <div style="text-align:right"><strong>${p.qty}</strong> porsi<div class="cell-soft">${rupiah(p.revenue)}</div></div>
            </div>`).join('') : '<p class="cell-soft">Belum ada produk terjual.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Rekap Harian</h3><div class="sub">Penjualan per tanggal</div></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Tanggal</th><th>Jumlah Pesanan</th><th>Pendapatan</th></tr></thead>
            <tbody>
              ${report.series.length ? report.series.map((s) => `<tr>
                <td>${fmtDate(s.day, false)}</td><td>${s.orders}</td><td class="cell-strong">${rupiah(s.revenue)}</td>
              </tr>`).join('') : '<tr><td colspan="3" class="empty-row">Tidak ada data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Detail Pesanan</h3><div class="sub">${orders.length} pesanan ditampilkan</div></div>
          <input class="input no-print" id="rSearch" placeholder="Cari pesanan…" style="width:220px" value="${esc(state.reportFilter.q)}">
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Tanggal</th><th>No. Pesanan</th><th>Pelanggan</th><th>Metode</th><th>Pembayaran</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              ${orders.length ? orders.map((o) => `<tr>
                <td class="cell-soft">${fmtDate(o.created_at, false)}</td>
                <td class="mono">${esc(o.order_number)}</td>
                <td>${esc(o.customer_name)}</td>
                <td class="cell-soft">${esc(o.method_label)}</td>
                <td class="cell-soft">${esc(o.payment_label)}</td>
                <td class="cell-strong">${rupiah(o.total)}</td>
                <td>${badge(o.status)}</td>
              </tr>`).join('') : '<tr><td colspan="7" class="empty-row">Tidak ada pesanan pada periode ini.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    const search = document.getElementById('rSearch');
    let t;
    search.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.reportFilter.q = e.target.value.trim();
        renderReportBody(state.report);
        document.getElementById('rSearch').focus();
      }, 250);
    });
  }

  async function renderReports() {
    const now = new Date();
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Laporan Penjualan</h1><p>Rekap penjualan harian, mingguan, dan bulanan beserta produk terlaris.</p></div>
        <div class="toolbar no-print" style="margin:0">
          <button class="btn btn-ghost" id="rPrint" disabled>🖨️ Cetak Laporan</button>
          <button class="btn btn-green" id="rCsv" disabled>⬇️ Ekspor CSV</button>
        </div>
      </div>
      <div class="card no-print">
        <div class="toolbar" style="margin:0">
          <select class="select" id="rPeriod">
            <option value="daily">Penjualan Harian</option>
            <option value="weekly">Penjualan Mingguan</option>
            <option value="monthly">Penjualan Bulanan</option>
          </select>
          <div class="field" style="flex-direction:row;align-items:center;gap:8px">
            <label style="white-space:nowrap">Dari</label>
            <input class="input" type="date" id="rFrom" value="${isoToday()}">
          </div>
          <div class="field" style="flex-direction:row;align-items:center;gap:8px">
            <label style="white-space:nowrap">Sampai</label>
            <input class="input" type="date" id="rTo" value="${isoToday()}">
          </div>
          <button class="btn btn-primary" id="rLoad">Tampilkan</button>
        </div>
      </div>
      <div id="reportBody"></div>`;

    const periodSel = document.getElementById('rPeriod');
    periodSel.addEventListener('change', () => {
      const d = reportDefaults(periodSel.value);
      document.getElementById('rFrom').value = d.from;
      document.getElementById('rTo').value = d.to;
      loadReport();
    });
    document.getElementById('rLoad').addEventListener('click', loadReport);
    document.getElementById('rPrint').addEventListener('click', () => window.print());
    document.getElementById('rCsv').addEventListener('click', () => {
      if (!state.report) return;
      exportCsv(state.report);
    });
    loadReport();
  }

  function exportCsv(report) {
    const rows = [[
      'No Pesanan', 'Tanggal', 'Pelanggan', 'WhatsApp', 'Metode Pemesanan', 'Metode Pembayaran',
      'Produk', 'Subtotal', 'Ongkos Kirim', 'Total', 'Status Pesanan', 'Status Pembayaran',
    ]];
    for (const o of report.orders) {
      rows.push([
        o.order_number,
        fmtDate(o.created_at),
        o.customer_name,
        o.whatsapp,
        o.method_label,
        o.payment_label,
        o.items.map((i) => `${i.product_name} x${i.qty}`).join('; '),
        o.subtotal,
        o.shipping_cost,
        o.total,
        o.status_label,
        o.transaction ? o.transaction.status : '-',
      ]);
    }
    const csv = '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-snacktime-${report.from}-sd-${report.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Laporan berhasil diekspor ke CSV.', 'success');
  }

  /* -------------------------------- settings ---------------------------- */
  async function renderSettings() {
    const { settings } = await api('/api/admin/settings');
    state.settings = settings;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Pengaturan Toko</h1><p>Informasi ini tampil di halaman pelanggan dan bukti pesanan.</p></div>
      </div>
      <form id="settingsForm">
        <div class="card">
          <div class="card-head"><div><h3>Informasi Toko</h3><div class="sub">Nama, kontak, dan jam operasional</div></div></div>
          <div class="form-grid">
            <div class="field span-2">
              <label>Nama toko</label>
              <input name="store_name" maxlength="80" required value="${esc(settings.store_name)}">
            </div>
            <div class="field">
              <label>Nomor WhatsApp penjual</label>
              <input name="whatsapp" maxlength="18" required value="${esc(settings.whatsapp)}" placeholder="6281234567890">
              <span class="hint">Gunakan format 62… tanpa + atau spasi.</span>
            </div>
            <div class="field">
              <label>Jam operasional</label>
              <input name="hours" maxlength="120" required value="${esc(settings.hours)}">
            </div>
            <div class="field span-2">
              <label>Alamat toko</label>
              <textarea name="address" maxlength="300" required>${esc(settings.address)}</textarea>
            </div>
            <div class="field">
              <label>Ongkos pengiriman default (Rp)</label>
              <input name="shipping_cost" type="number" min="0" step="500" required value="${settings.shipping_cost}">
              <span class="hint">Berlaku untuk metode Pesan Antar. Dapat diubah per pesanan di menu Pengiriman.</span>
            </div>
            <div class="field">
              <label>Logo toko (opsional)</label>
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp">
              ${settings.logo ? `<img src="${esc(settings.logo)}" alt="Logo toko" style="width:70px;height:70px;border-radius:12px;object-fit:cover;margin-top:8px">` : '<span class="hint">Belum ada logo. Ikon default digunakan.</span>'}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>Pembayaran</h3><div class="sub">Tampil saat pelanggan memilih Transfer Bank atau QRIS</div></div></div>
          <div class="form-grid">
            <div class="field"><label>Nama bank</label><input name="bank_name" maxlength="40" value="${esc(settings.bank_name || '')}" placeholder="BCA"></div>
            <div class="field"><label>Nomor rekening</label><input name="bank_account" maxlength="40" value="${esc(settings.bank_account || '')}" placeholder="1234567890"></div>
            <div class="field span-2"><label>Nama pemilik rekening</label><input name="bank_holder" maxlength="80" value="${esc(settings.bank_holder || '')}" placeholder="SnackTime Indonesia"></div>
            <div class="field span-2">
              <label>Gambar QRIS (opsional)</label>
              <input type="file" name="qris" accept="image/png,image/jpeg,image/webp">
              ${settings.qris_image ? `<img src="${esc(settings.qris_image)}" alt="QRIS" style="width:180px;border-radius:12px;margin-top:8px;border:1px solid var(--line)">` : '<span class="hint">Belum ada gambar QRIS.</span>'}
            </div>
          </div>
        </div>

        <div class="form-error" id="setErr" style="margin-bottom:14px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:40px">
          <button class="btn btn-primary" type="submit" id="saveSettings">Simpan Pengaturan</button>
        </div>
      </form>`;

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('setErr');
      const btn = document.getElementById('saveSettings');
      err.classList.remove('show');
      const fd = new FormData(e.target);
      ['logo', 'qris'].forEach((k) => { if (!fd.get(k) || !fd.get(k).size) fd.delete(k); });
      btn.disabled = true;
      btn.textContent = 'Menyimpan…';
      try {
        await api('/api/admin/settings', { method: 'PUT', body: fd });
        toast('Pengaturan toko berhasil disimpan.', 'success');
        setTab('settings');
      } catch (error) {
        err.textContent = error.message;
        err.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Simpan Pengaturan';
      }
    });
  }

  /* --------------------------------- logout ----------------------------- */
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    location.replace('/admin/');
  });

  /* ---------------------------------- boot ------------------------------ */
  (async () => {
    try {
      await api('/api/admin/me');
      loadNotifications();
      setInterval(loadNotifications, 25000);
      setTab('dashboard');
    } catch (err) {
      if (err.message !== 'Sesi berakhir.') {
        view.innerHTML = `<div class="card"><p style="color:var(--red)">${esc(err.message)}</p></div>`;
      }
    }
  })();
})();
