/* Checkout page */
(function () {
  const ST = window.ST;
  ST.mountHeader('menu');
  ST.mountFooter();

  const form = document.getElementById('checkoutForm');
  const emptyBox = document.getElementById('checkoutEmpty');
  const itemsBox = document.getElementById('summaryItems');
  const errorBox = document.getElementById('checkoutError');
  const submitBtn = document.getElementById('submitBtn');
  const deliveryFields = document.getElementById('deliveryFields');
  const paymentInfo = document.getElementById('paymentInfo');

  let settings = null;
  let items = ST.cart.all();
  let method = 'delivery';
  let payment = 'cash';

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() { errorBox.classList.remove('show'); }

  function shippingFee() {
    return method === 'delivery' ? Number(settings?.shipping_cost || 0) : 0;
  }

  function renderSummary() {
    if (!items.length) {
      form.style.display = 'none';
      emptyBox.style.display = 'block';
      return;
    }
    emptyBox.style.display = 'none';
    form.style.display = 'grid';

    itemsBox.innerHTML = items.map((i) => `
      <div class="mini-item">
        <img src="${ST.esc(i.image)}" alt="${ST.esc(i.name)}">
        <div>
          <strong>${ST.esc(i.name)}</strong>
          <small>${i.qty} × ${ST.rupiah(i.price)}</small>
        </div>
        <span class="amt">${ST.rupiah(i.price * i.qty)}</span>
      </div>`).join('');

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    document.getElementById('sumSubtotal').textContent = ST.rupiah(subtotal);
    document.getElementById('sumShipping').textContent = method === 'delivery' ? ST.rupiah(shippingFee()) : 'Gratis';
    document.getElementById('sumTotal').textContent = ST.rupiah(subtotal + shippingFee());
  }

  function renderPaymentInfo() {
    if (!settings) return;
    if (payment === 'cash') {
      paymentInfo.style.display = 'none';
      return;
    }
    paymentInfo.style.display = 'block';
    if (payment === 'transfer') {
      const bank = settings.bank || {};
      const configured = bank.name && bank.account;
      paymentInfo.innerHTML = `
        <strong>Informasi Transfer Bank</strong>
        ${configured ? `
          <div class="row"><span>Bank</span><span>${ST.esc(bank.name)}</span></div>
          <div class="row"><span>Nomor rekening</span><span><strong>${ST.esc(bank.account)}</strong></span></div>
          <div class="row"><span>Atas nama</span><span>${ST.esc(bank.holder)}</span></div>` : '<p>Admin belum mengatur rekening pembayaran. Silakan hubungi penjual.</p>'}
        <div class="warn">⚠️ Status Lunas baru muncul setelah admin memverifikasi pembayaranmu.</div>`;
    } else {
      paymentInfo.innerHTML = `
        <strong>Pembayaran QRIS</strong>
        <div class="qris-box">
          ${settings.qris_image
            ? `<img src="${ST.esc(settings.qris_image)}" alt="QRIS SnackTime">`
            : '<div class="qris-placeholder">Gambar QRIS belum diunggah admin. Silakan minta kode QR ke penjual.</div>'}
          <small>Scan dengan aplikasi bank atau e-wallet yang mendukung QRIS.</small>
        </div>
        <div class="warn">⚠️ Status Lunas baru muncul setelah admin memverifikasi pembayaranmu.</div>`;
    }
  }

  function selectMethod(value) {
    method = value;
    document.querySelectorAll('input[name="method"]').forEach((input) => {
      input.checked = input.value === value;
      input.closest('.option').classList.toggle('checked', input.checked);
    });
    deliveryFields.style.display = value === 'delivery' ? 'block' : 'none';
    renderSummary();
  }

  function selectPayment(value) {
    payment = value;
    document.querySelectorAll('input[name="payment"]').forEach((input) => {
      input.checked = input.value === value;
      input.closest('.option').classList.toggle('checked', input.checked);
    });
    renderPaymentInfo();
  }

  document.getElementById('methodOptions').addEventListener('change', (e) => {
    if (e.target.name === 'method') selectMethod(e.target.value);
  });
  document.getElementById('paymentOptions').addEventListener('change', (e) => {
    if (e.target.name === 'payment') selectPayment(e.target.value);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const name = document.getElementById('custName').value.trim();
    const whatsapp = document.getElementById('custWa').value.replace(/\D/g, '');
    if (name.length < 2) return showError('Nama pelanggan minimal 2 karakter.');
    if (whatsapp.length < 9 || whatsapp.length > 15) return showError('Nomor WhatsApp tidak valid (9–15 digit).');

    let payload = { name, whatsapp, method, payment_method: payment, items: [], note: document.getElementById('note').value.trim() };

    if (method === 'delivery') {
      const recipient = document.getElementById('recipient').value.trim();
      const recipientPhone = document.getElementById('recipientPhone').value.replace(/\D/g, '');
      const address = document.getElementById('address').value.trim();
      const landmark = document.getElementById('landmark').value.trim();
      if (recipient.length < 2) return showError('Nama penerima wajib diisi.');
      if (recipientPhone.length < 9) return showError('Nomor WhatsApp penerima tidak valid.');
      if (address.length < 10) return showError('Alamat lengkap minimal 10 karakter agar kurir mudah menemukan lokasimu.');
      if (landmark.length < 3) return showError('Patokan lokasi wajib diisi (contoh: depan masjid).');
      Object.assign(payload, { recipient, recipient_phone: recipientPhone, address, landmark });
    }

    payload.items = items.map((i) => ({ product_id: i.id, qty: i.qty }));

    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses pesanan…';
    try {
      const data = await ST.api('/api/orders', { method: 'POST', body: payload });
      ST.cart.clear();
      localStorage.setItem('snacktime_last_order', JSON.stringify({
        order: data.order.order_number,
        wa: data.order.whatsapp,
      }));
      ST.toast('Pesanan berhasil dibuat!', 'success');
      setTimeout(() => {
        location.href = `/pesanan.html?order=${encodeURIComponent(data.order.order_number)}&wa=${encodeURIComponent(data.order.whatsapp)}`;
      }, 400);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Buat Pesanan';
    }
  });

  (async () => {
    try {
      settings = await ST.getSettings();
      const { products } = await ST.api('/api/products');
      const byId = new Map(products.map((p) => [p.id, p]));
      let changed = false;
      items = ST.cart.all().flatMap((i) => {
        const p = byId.get(i.id);
        if (!p || !p.available) { changed = true; return []; }
        const qty = Math.min(i.qty, p.stock);
        if (qty !== i.qty || p.price !== i.price) changed = true;
        return [{ ...i, name: p.name, price: p.price, image: p.image, stock: p.stock, qty }];
      }).filter((i) => i.qty > 0);
      if (changed) {
        ST.cart.clear();
        items.forEach((i) => ST.cart.add(i, i.qty));
        ST.toast('Keranjang disesuaikan dengan stok & harga terbaru.', 'info');
      }
      selectMethod(method);
      selectPayment(payment);
      renderSummary();
    } catch (err) {
      showError(err.message);
    }
  })();

  renderSummary();
})();
