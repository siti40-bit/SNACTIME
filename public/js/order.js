/* Order receipt & status tracking */
(function () {
  const ST = window.ST;
  ST.mountHeader('');
  ST.mountFooter();

  const trackForm = document.getElementById('trackForm');
  const receiptArea = document.getElementById('receiptArea');
  const trackError = document.getElementById('trackError');
  const params = new URLSearchParams(location.search);
  let settings = null;
  let current = null;

  function showTrackError(msg) {
    trackError.textContent = msg;
    trackError.classList.add('show');
  }

  function timelineSteps(order) {
    const steps = [{ key: 'baru', label: 'Pesanan Baru', desc: 'Pesanan diterima sistem SnackTime.' }];
    if (order.payment_method !== 'cash') steps.push({ key: 'menunggu_pembayaran', label: 'Menunggu Pembayaran', desc: 'Selesaikan pembayaran sesuai instruksi.' });
    steps.push({ key: 'pembayaran_dikonfirmasi', label: 'Pembayaran Dikonfirmasi', desc: 'Admin sudah memverifikasi pembayaran.' });
    steps.push({ key: 'diproses', label: 'Sedang Diproses', desc: 'Cemilanmu sedang disiapkan.' });
    if (order.method === 'pickup') steps.push({ key: 'siap_diambil', label: 'Siap Diambil', desc: 'Pesanan siap diambil di toko.' });
    if (order.method === 'delivery') steps.push({ key: 'sedang_diantar', label: 'Sedang Diantar', desc: 'Kurir sedang menuju alamatmu.' });
    steps.push({ key: 'selesai', label: 'Selesai', desc: 'Pesanan telah diterima. Selamat menikmati!' });
    return steps;
  }

  function renderTimeline(order) {
    const el = document.getElementById('timeline');
    if (order.status === 'dibatalkan') {
      el.innerHTML = `<li class="active"><span class="dot">✕</span><div><strong>Pesanan Dibatalkan</strong>
        <small>Pesanan ini dibatalkan. Hubungi penjual bila perlu bantuan.</small></div></li>`;
      return;
    }
    const steps = timelineSteps(order);
    const idx = steps.findIndex((s) => s.key === order.status);
    el.innerHTML = steps.map((s, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'active' : '';
      return `<li class="${cls}"><span class="dot">${i < idx ? '✓' : i + 1}</span>
        <div><strong>${s.label}</strong><small>${s.desc}</small></div></li>`;
    }).join('');
  }

  function renderPayment(order) {
    const body = document.getElementById('paymentPanelBody');
    const trx = order.transaction || {};
    const paid = trx.status === 'paid';
    if (paid) {
      body.innerHTML = `<div class="badge paid" style="margin-bottom:10px">✓ Pembayaran Terverifikasi</div>
        <p>Pembayaran sudah dikonfirmasi admin${trx.paid_at ? ` pada ${ST.formatDate(trx.paid_at)}` : ''}.</p>
        <p style="margin-top:8px">Kode transaksi: <strong>${ST.esc(trx.code || '-')}</strong></p>`;
    } else if (order.payment_method === 'cash') {
      body.innerHTML = `<div class="badge wait" style="margin-bottom:10px">Tunai</div>
        <p>Bayar tunai saat pesanan diterima. Status lunas akan diperbarui admin setelah pembayaran diterima.</p>`;
    } else if (order.payment_method === 'transfer') {
      const bank = settings.bank || {};
      body.innerHTML = `<div class="pay-info" style="margin-top:0">
        <strong>Transfer Bank</strong>
        <div class="row"><span>Bank</span><span>${ST.esc(bank.name || '-')}</span></div>
        <div class="row"><span>Nomor rekening</span><span><strong>${ST.esc(bank.account || '-')}</strong></span></div>
        <div class="row"><span>Atas nama</span><span>${ST.esc(bank.holder || '-')}</span></div>
        <div class="row"><span>Jumlah</span><span><strong>${ST.rupiah(order.total)}</strong></span></div>
        <div class="warn">⚠️ ${order.payment_claimed ? 'Konfirmasi pembayaranmu sudah dikirim. Menunggu verifikasi admin.' : 'Status Lunas muncul setelah admin memverifikasi pembayaranmu.'}</div>
      </div>`;
    } else {
      body.innerHTML = `<div class="pay-info" style="margin-top:0">
        <strong>QRIS</strong>
        <div class="qris-box">
          ${settings.qris_image
            ? `<img src="${ST.esc(settings.qris_image)}" alt="QRIS SnackTime">`
            : '<div class="qris-placeholder">Admin belum mengunggah gambar QRIS. Silakan minta kode QR ke penjual.</div>'}
          <div class="row"><span>Jumlah</span><span><strong>${ST.rupiah(order.total)}</strong></span></div>
        </div>
        <div class="warn">⚠️ ${order.payment_claimed ? 'Konfirmasi pembayaranmu sudah dikirim. Menunggu verifikasi admin.' : 'Status Lunas muncul setelah admin memverifikasi pembayaranmu.'}</div>
      </div>`;
    }
  }

  function waMessage(order) {
    const lines = [
      `Halo SnackTime! Saya ingin konfirmasi pesanan:`,
      ``,
      `Nomor pesanan: ${order.order_number}`,
      `Nama: ${order.customer_name}`,
      `Metode pemesanan: ${order.method_label}`,
      `Metode pembayaran: ${order.payment_label}`,
      ``,
      `Detail pesanan:`,
      ...order.items.map((i) => `• ${i.product_name} × ${i.qty} — ${ST.rupiah(i.line_total)}`),
      ``,
      `Subtotal: ${ST.rupiah(order.subtotal)}`,
      `Ongkos kirim: ${ST.rupiah(order.shipping_cost)}`,
      `Total: ${ST.rupiah(order.total)}`,
      ``,
      order.method === 'delivery' ? `Alamat: ${order.address} (patokan: ${order.landmark})` : '',
      `Status saat ini: ${order.status_label}`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  function renderOrder(order) {
    current = order;
    trackForm.style.display = 'none';
    receiptArea.style.display = 'block';
    document.getElementById('pageTitle').textContent = `Pesanan ${order.order_number}`;
    document.getElementById('pageSubtitle').textContent = `Terima kasih, ${order.customer_name}! Simpan nomor pesanan ini untuk melacak status pesananmu.`;

    document.getElementById('receiptStore').textContent = settings.store_name;
    document.getElementById('receiptNumber').textContent = order.order_number;
    document.getElementById('receiptDate').textContent = ST.formatDate(order.created_at);
    document.getElementById('receiptStatus').innerHTML = ST.statusBadge(order.status) +
      `<span style="font-size:.8rem;color:var(--ink-soft);margin-left:10px">Update: ${ST.formatDate(order.updated_at)}</span>`;
    document.getElementById('rName').textContent = order.customer_name;
    document.getElementById('rWa').textContent = '+' + order.whatsapp;
    document.getElementById('rMethod').textContent = order.method_label;
    document.getElementById('rPayment').textContent = order.payment_label;

    const delivery = document.getElementById('rDelivery');
    if (order.method === 'delivery' && order.address) {
      delivery.style.display = 'block';
      document.getElementById('rDeliveryText').innerHTML =
        `Penerima: <strong>${ST.esc(order.recipient || order.customer_name)}</strong><br>${ST.esc(order.address)}<br>Patokan: ${ST.esc(order.landmark || '-')}`;
    } else delivery.style.display = 'none';

    document.getElementById('rItems').innerHTML = order.items.map((i) => `
      <tr><td>${ST.esc(i.product_name)}</td><td>${i.qty}</td><td>${ST.rupiah(i.price)}</td><td>${ST.rupiah(i.line_total)}</td></tr>`).join('');
    document.getElementById('rSubtotal').textContent = ST.rupiah(order.subtotal);
    document.getElementById('rShipping').textContent = order.shipping_cost > 0 ? ST.rupiah(order.shipping_cost) : 'Gratis';
    document.getElementById('rTotal').textContent = ST.rupiah(order.total);

    const note = document.getElementById('rNote');
    if (order.note) { note.style.display = 'block'; note.innerHTML = `<strong>Catatan:</strong> ${ST.esc(order.note)}`; }
    else note.style.display = 'none';

    renderTimeline(order);
    renderPayment(order);

    const wa = String(settings.whatsapp).replace(/\D/g, '');
    document.getElementById('btnWa').href = `https://wa.me/${wa}?text=${encodeURIComponent(waMessage(order))}`;
    document.getElementById('btnChatStore').href = `https://wa.me/${wa}?text=${encodeURIComponent(`Halo SnackTime, saya ingin bertanya tentang pesanan ${order.order_number}.`)}`;

    const confirmBtn = document.getElementById('btnConfirm');
    const isPaid = order.transaction && order.transaction.status === 'paid';
    const closed = order.status === 'dibatalkan' || order.status === 'selesai';
    if (isPaid || closed) {
      confirmBtn.style.display = 'none';
    } else {
      confirmBtn.style.display = 'inline-flex';
      confirmBtn.textContent = order.payment_method === 'cash' ? 'Konfirmasi Pesanan' : 'Konfirmasi Pembayaran';
      confirmBtn.disabled = order.payment_claimed;
      confirmBtn.textContent = order.payment_claimed ? 'Konfirmasi Terkirim ✓' : confirmBtn.textContent;
    }
    localStorage.setItem('snacktime_last_order', JSON.stringify({ order: order.order_number, wa: order.whatsapp }));
  }

  async function loadOrder(number, wa) {
    try {
      const data = await ST.api(`/api/orders/${encodeURIComponent(number)}?wa=${encodeURIComponent(wa)}`);
      settings = data.settings;
      renderOrder(data.order);
      history.replaceState(null, '', `/pesanan.html?order=${encodeURIComponent(number)}&wa=${encodeURIComponent(wa)}`);
    } catch (err) {
      trackForm.style.display = 'block';
      showTrackError(err.message);
      document.getElementById('trackOrder').value = number || '';
      document.getElementById('trackWa').value = wa || '';
    }
  }

  document.getElementById('btnRefresh').addEventListener('click', async () => {
    if (!current) return;
    try {
      const data = await ST.api(`/api/orders/${encodeURIComponent(current.order_number)}?wa=${encodeURIComponent(current.whatsapp)}`);
      settings = data.settings;
      renderOrder(data.order);
      ST.toast('Status pesanan diperbarui.', 'success');
    } catch (err) { ST.toast(err.message, 'error'); }
  });

  document.getElementById('btnConfirm').addEventListener('click', async () => {
    if (!current) return;
    const btn = document.getElementById('btnConfirm');
    btn.disabled = true;
    try {
      const data = await ST.api(`/api/orders/${encodeURIComponent(current.order_number)}/confirm`, {
        method: 'POST', body: { whatsapp: current.whatsapp },
      });
      ST.toast(data.message, 'success');
      renderOrder(data.order);
      if (settings) renderPayment(data.order);
    } catch (err) {
      ST.toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  trackForm.addEventListener('submit', (e) => {
    e.preventDefault();
    trackError.classList.remove('show');
    const number = document.getElementById('trackOrder').value.trim();
    const wa = document.getElementById('trackWa').value.replace(/\D/g, '');
    if (!number) return showTrackError('Nomor pesanan wajib diisi.');
    if (wa.length < 9) return showTrackError('Nomor WhatsApp tidak valid.');
    loadOrder(number, wa);
  });

  // Auto-fill from URL, then from the last order saved in this browser.
  (async () => {
    settings = await ST.getSettings();
    const orderParam = params.get('order');
    const waParam = params.get('wa');
    if (orderParam) {
      document.getElementById('trackOrder').value = orderParam;
      if (waParam) document.getElementById('trackWa').value = waParam;
      return loadOrder(orderParam, waParam || '');
    }
    try {
      const last = JSON.parse(localStorage.getItem('snacktime_last_order') || 'null');
      if (last && last.order && last.wa) {
        document.getElementById('trackOrder').value = last.order;
        document.getElementById('trackWa').value = last.wa;
        return loadOrder(last.order, last.wa);
      }
    } catch { /* ignore */ }
  })();
})();
