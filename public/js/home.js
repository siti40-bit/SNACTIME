/* Homepage: load featured products into the grid */
(function () {
  const ST = window.ST;
  ST.mountHeader('home');
  ST.mountFooter();

  const grid = document.getElementById('homeProducts');

  (async () => {
    try {
      const { products } = await ST.api('/api/products');
      document.getElementById('statProducts').textContent = `${products.length}+`;
      const featured = products.filter((p) => p.available).slice(0, 8);
      const list = featured.length ? featured : products.slice(0, 8);
      if (!list.length) {
        grid.innerHTML = '<div class="empty"><span class="emoji">🍿</span>Belum ada produk yang tersedia.</div>';
        return;
      }
      grid.innerHTML = list.map(ST.productCard).join('');
      ST.bindProductGrid(list);
    } catch (err) {
      grid.innerHTML = `<div class="empty"><span class="emoji">⚠️</span>Gagal memuat produk. ${ST.esc(err.message)}</div>`;
    }
  })();
})();
