/* Menu page: search, category filter, sort, add to cart */
(function () {
  const ST = window.ST;
  ST.mountHeader('menu');
  ST.mountFooter();

  const state = { search: '', category: '', sort: '' };
  const grid = document.getElementById('productGrid');
  const resultLine = document.getElementById('resultLine');
  const chips = document.getElementById('categoryChips');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  let products = [];
  const categories = ['Cemilan Gurih', 'Cemilan Manis', 'Cemilan Pedas', 'Makanan Ringan', 'Minuman'];

  const params = new URLSearchParams(location.search);
  if (params.get('category')) state.category = params.get('category');
  if (params.get('q')) { state.search = params.get('q'); searchInput.value = state.search; }

  function renderChips() {
    chips.innerHTML = [`<button class="chip ${state.category ? '' : 'active'}" data-cat="">Semua</button>`]
      .concat(categories.map((c) => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${ST.esc(c)}">${ST.esc(c)}</button>`))
      .join('');
  }

  async function load() {
    resultLine.textContent = 'Memuat produk…';
    try {
      const qs = new URLSearchParams();
      if (state.search) qs.set('search', state.search);
      if (state.category) qs.set('category', state.category);
      if (state.sort) qs.set('sort', state.sort);
      const data = await ST.api(`/api/products?${qs.toString()}`);
      products = data.products;
      if (!products.length) {
        grid.innerHTML = `<div class="empty"><span class="emoji">🔍</span>
          <h3>Produk tidak ditemukan</h3>
          <p style="font-size:.86rem;margin-top:6px">Coba kata kunci lain atau pilih kategori "Semua".</p></div>`;
        resultLine.textContent = 'Tidak ada produk yang cocok.';
        return;
      }
      grid.innerHTML = products.map(ST.productCard).join('');
      resultLine.textContent = `Menampilkan ${products.length} produk${state.category ? ` · ${state.category}` : ''}`;
    } catch (err) {
      grid.innerHTML = `<div class="empty"><span class="emoji">⚠️</span>${ST.esc(err.message)}</div>`;
      resultLine.textContent = '';
    }
  }

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    renderChips();
    load();
  });

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.search = searchInput.value.trim(); load(); }, 260);
  });
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; load(); });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const product = products.find((p) => p.id === Number(btn.dataset.add));
    if (!product) return;
    if (ST.cart.add(product)) {
      btn.classList.add('added');
      btn.innerHTML = '✓';
      setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = ST.icons.plus; }, 900);
      ST.toast(`${product.name} ditambahkan ke keranjang`, 'success');
    }
  });

  renderChips();
  load();
})();
