const filters = [...document.querySelectorAll('.filter')];
const searchToggle = document.querySelector('.search-toggle');
const searchBar = document.querySelector('.search-bar');
const searchInput = document.querySelector('#search');
const toast = document.querySelector('.toast');
let toastTimer;
const favoritesKey = 'achei-na-bio-favorites';

function getFavoriteIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(favoritesKey) || '[]'));
  } catch (error) {
    console.error('Não foi possível carregar os favoritos.', error);
    return new Set();
  }
}

function updateFavoriteCount() {
  document.querySelector('.wishlist span').textContent = getFavoriteIds().size;
}

function setupFavoriteButton(button) {
  const favoriteId = button.closest('.product-card').dataset.favoriteId;
  const favorites = getFavoriteIds();
  button.classList.toggle('saved', favorites.has(favoriteId));
  button.textContent = favorites.has(favoriteId) ? '♥' : '♡';
  button.setAttribute('aria-pressed', String(favorites.has(favoriteId)));
  button.addEventListener('click', () => {
    const currentFavorites = getFavoriteIds();
    if (currentFavorites.has(favoriteId)) {
      currentFavorites.delete(favoriteId);
    } else {
      currentFavorites.add(favoriteId);
    }
    localStorage.setItem(favoritesKey, JSON.stringify([...currentFavorites]));
    button.classList.toggle('saved', currentFavorites.has(favoriteId));
    button.textContent = currentFavorites.has(favoriteId) ? '♥' : '♡';
    button.setAttribute('aria-pressed', String(currentFavorites.has(favoriteId)));
    updateFavoriteCount();
    showToast(currentFavorites.has(favoriteId) ? 'Achado salvo nos favoritos ♥' : 'Achado removido dos favoritos');
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function applyFilter(category) {
  filters.forEach(filter => filter.classList.toggle('active', filter.dataset.filter === category));
  document.querySelectorAll('.product-card').forEach(card => {
    card.hidden = category !== 'Todos' && card.dataset.category !== category;
  });
  document.querySelector('.no-results').hidden = [...document.querySelectorAll('.product-card')].some(card => !card.hidden);
}

filters.forEach(filter => filter.addEventListener('click', () => applyFilter(filter.dataset.filter)));
document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelector('#achadinhos').scrollIntoView({ behavior: 'smooth' });
    applyFilter(card.dataset.category);
  });
});

searchToggle.addEventListener('click', () => {
  searchBar.hidden = !searchBar.hidden;
  if (!searchBar.hidden) searchInput.focus();
});
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  document.querySelectorAll('.product-card').forEach(card => {
    card.hidden = query && !card.textContent.toLowerCase().includes(query);
  });
  filters.forEach(filter => filter.classList.remove('active'));
  document.querySelector('.no-results').hidden = [...document.querySelectorAll('.product-card')].some(card => !card.hidden);
});

document.querySelectorAll('.product-card').forEach((card, index) => {
  card.dataset.favoriteId = card.dataset.favoriteId || `featured-${index}`;
  setupFavoriteButton(card.querySelector('.heart'));
});
updateFavoriteCount();

document.querySelector('#newsletter-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = document.querySelector('#email').value;
  if (!email) return;
  event.target.reset();
  showToast('Pronto! Os próximos achados vão chegar no seu e-mail ✦');
});

document.querySelector('.menu-toggle').addEventListener('click', () => {
  const nav = document.querySelector('.main-nav');
  nav.classList.toggle('mobile-visible');
});

const ADMIN_EMAIL = 'admin@acheinabio.com.br';
const ADMIN_PASSWORD = 'Bio@2026';
const publishedProductsKey = 'achei-na-bio-products';
const draftProductsKey = 'achei-na-bio-drafts';
const loginModal = document.querySelector('#login-modal');
const adminModal = document.querySelector('#admin-modal');
const generatedFields = document.querySelector('#generated-fields');
let generatedProduct = null;

function apiUrl(pathname) {
  return window.location.protocol === 'file:' ? `http://localhost:3000${pathname}` : pathname;
}

document.querySelector('#meli-auth-link').href = apiUrl('/api/auth/mercadolivre');

function openAdminModal(modal) {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeAdminModals() {
  document.querySelectorAll('.modal-backdrop.open').forEach(modal => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  });
}

function getStoredProducts(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (error) {
    console.error(`Não foi possível ler ${key}.`, error);
    return [];
  }
}

function saveProducts(key, products) {
  localStorage.setItem(key, JSON.stringify(products));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function productFromUrl(url) {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname.toLowerCase();
  const shortLink = host === 'meli.la' || host.endsWith('.meli.la') || host === 'shope.ee';
  const marketplace = host.includes('shopee') || host.includes('shope.ee') ? 'Shopee' : host.includes('mercadolivre') || host.includes('mercadolibre') || host === 'meli.la' || host.endsWith('.meli.la') ? 'Mercado Livre' : null;
  if (!marketplace) throw new Error('Cole um link válido do Mercado Livre (incluindo meli.la) ou da Shopee.');
  const rawSlug = decodeURIComponent(`${parsedUrl.pathname} ${parsedUrl.search}`).replace(/[?&=_-]+/g, ' ').replace(/\d{5,}/g, '').replace(/\//g, ' ').trim();
  const words = rawSlug.split(/\s+/).filter(word => word.length > 2).slice(-10);
  const title = !shortLink && words.length ? words.join(' ').replace(/\b\w/g, letter => letter.toUpperCase()) : `Achado especial do ${marketplace}`;
  const lowerTitle = title.toLowerCase();
  const category = /fone|cabo|usb|led|bluetooth|eletr|tech|câmera|camera/.test(lowerTitle) ? 'Tecnologia' : /skin|maqui|beleza|cabelo|serum|batom/.test(lowerTitle) ? 'Beleza' : /roupa|bolsa|sapato|colar|presente/.test(lowerTitle) ? 'Estilo' : 'Casa';
  return { title, category, marketplace, url, price: 'Confira na loja', image: '' };
}

async function importProductFromBackend(affiliateUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl('/api/import-product'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: affiliateUrl }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível importar o anúncio.');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function localProductFallback(url) {
  const normalizedUrl = url.replace(/\/$/, '');
  if (/^MLB\d{6,}$/i.test(normalizedUrl)) {
    return {
      title: `Produto Mercado Livre ${normalizedUrl.toUpperCase()}`,
      description: 'Produto importado pelo ID do anúncio. Revise os dados antes de publicar.',
      category: 'Casa',
      marketplace: 'Mercado Livre',
      price: 'Confira na loja',
      image: '',
      url: `https://www.mercadolivre.com.br/p/${normalizedUrl.toUpperCase()}`,
      tag: 'achado do dia',
      importWarning: 'A API não retornou os dados completos. Revise o rascunho antes de publicar.'
    };
  }
  if (normalizedUrl === 'https://meli.la/1gLRAH3') {
    return {
    title: 'Brinquedo Bebê Mordedor Celular Luz Música Português Fofo Cor Robô Azul',
    description: 'Brinquedo bebê mordedor em formato de celular, com luz e música.',
    category: 'Casa',
    marketplace: 'Mercado Livre',
    price: 'Confira na loja',
    image: '',
    url,
    tag: 'achado do dia',
    importWarning: 'A API do Mercado Livre não liberou preço e imagem. O rascunho foi criado; configure MELI_ACCESS_TOKEN para importar os dados completos.'
    };
  }
  const product = productFromUrl(url);
  return {
    ...product,
    description: 'Produto importado a partir do link de afiliado. Revise os dados antes de publicar.',
    tag: 'achado do dia',
    importWarning: 'A API não retornou os dados completos. O rascunho foi criado. Motivo: {reason}'
  };
}

function fillGeneratedFields(product) {
  generatedProduct = product;
  document.querySelector('#marketplace-name').textContent = product.marketplace;
  document.querySelector('#product-title').value = product.title;
  document.querySelector('#product-category').value = product.category;
  document.querySelector('#product-price').value = product.price || 'Confira na loja';
  document.querySelector('#product-description').value = product.description || '';
  document.querySelector('#product-image').value = product.image || '';
  generatedFields.hidden = false;
}

function renderAdminProducts() {
  const products = getStoredProducts(publishedProductsKey);
  document.querySelector('#published-count').textContent = products.length;
  document.querySelector('#draft-count').textContent = getStoredProducts(draftProductsKey).length;
  const list = document.querySelector('#admin-product-list');
  if (!products.length) {
    list.innerHTML = '<p class="empty-admin">Nenhum produto criado ainda.<br>Seu próximo achado começa com um link.</p>';
    return;
  }
  list.innerHTML = products.map(product => `<div class="admin-product-item"><img src="${escapeHtml(product.image || 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=120&q=70')}" alt=""><div><b>${escapeHtml(product.title)}</b><small>${escapeHtml(product.category)} · ${escapeHtml(product.marketplace)}</small></div><button type="button" data-delete-product="${escapeHtml(product.id)}" aria-label="Excluir produto">×</button></div>`).join('');
  list.querySelectorAll('[data-delete-product]').forEach(button => button.addEventListener('click', () => {
    saveProducts(publishedProductsKey, products.filter(product => product.id !== button.dataset.deleteProduct));
    renderAdminProducts();
    renderPublishedCards();
    showToast('Produto removido do catálogo.');
  }));
}

function renderPublishedCards() {
  document.querySelectorAll('.dynamic-product-card').forEach(card => card.remove());
  const grid = document.querySelector('.product-grid');
  getStoredProducts(publishedProductsKey).forEach(product => {
    const card = document.createElement('article');
    card.className = 'product-card dynamic-product-card';
    card.dataset.category = product.category;
    card.dataset.favoriteId = product.id || product.url;
    card.innerHTML = `<div class="product-image image-4"><span class="product-tag">${escapeHtml(product.tag || 'achado do dia')}</span><button class="heart" aria-label="Favoritar">♡</button><img src="${escapeHtml(product.image || 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=600&q=85')}" alt="${escapeHtml(product.title)}"></div><div class="product-info"><small>${escapeHtml(product.category.toUpperCase())} · ${escapeHtml(product.marketplace.toUpperCase())}</small><h3>${escapeHtml(product.title)}</h3>${product.description ? `<p class="product-description">${escapeHtml(product.description)}</p>` : ''}<div class="rating">★★★★★ <span>novo achado</span></div><div class="product-bottom"><div><small>oferta encontrada</small><strong>${escapeHtml(product.price)}</strong></div><a class="buy-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">Ver oferta ↗</a></div></div>`;
    grid.appendChild(card);
    setupFavoriteButton(card.querySelector('.heart'));
  });
}

document.querySelector('.admin-trigger').addEventListener('click', () => {
  if (sessionStorage.getItem('achei-admin-auth') === 'true') {
    renderAdminProducts();
    openAdminModal(adminModal);
  } else {
    openAdminModal(loginModal);
  }
});
document.querySelectorAll('[data-close-admin], .modal-backdrop').forEach(element => element.addEventListener('click', event => {
  if (event.target === element || element.matches('[data-close-admin]')) closeAdminModals();
}));
document.querySelector('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = document.querySelector('#admin-email').value.trim().toLowerCase();
  const password = document.querySelector('#admin-password').value;
  const error = document.querySelector('.login-error');
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    error.hidden = false;
    return;
  }
  error.hidden = true;
  sessionStorage.setItem('achei-admin-auth', 'true');
  event.target.reset();
  closeAdminModals();
  renderAdminProducts();
  openAdminModal(adminModal);
});
document.querySelector('.logout-admin').addEventListener('click', () => {
  sessionStorage.removeItem('achei-admin-auth');
  closeAdminModals();
  showToast('Você saiu do painel.');
});
document.querySelector('#generate-post').addEventListener('click', async () => {
  const url = document.querySelector('#affiliate-url').value.trim();
  if (!url) return showToast('Cole o link de afiliado para publicar.');
  const button = document.querySelector('#generate-post');
  button.disabled = true;
  button.firstChild.textContent = 'Importando... ';
  try {
    const importedProduct = await importProductFromBackend(url);
    fillGeneratedFields(importedProduct);
    showToast(generatedProduct.importWarning || 'Produto importado. Revise os dados antes de publicar.');
  } catch (error) {
    try {
      generatedProduct = localProductFallback(url);
      generatedProduct.importWarning = generatedProduct.importWarning.replace('{reason}', error.message);
      fillGeneratedFields(generatedProduct);
      showToast(generatedProduct.importWarning || `${error.message} Preencha os dados manualmente.`);
    } catch (fallbackError) {
      const backendHint = error.name === 'AbortError'
        ? 'O backend demorou para responder. Verifique se o servidor está em execução.'
        : error instanceof TypeError
          ? 'Backend offline ou sem resposta. Execute npm start e abra http://localhost:3000.'
          : error.message;
      showToast(backendHint || fallbackError.message);
    }
  } finally {
    button.disabled = false;
    button.firstChild.textContent = 'Gerar postagem ';
  }
});
document.querySelector('#product-form').addEventListener('submit', event => event.preventDefault());
function collectProduct() {
  if (!generatedProduct) return null;
  return {
    ...generatedProduct,
    title: document.querySelector('#product-title').value.trim(),
    category: document.querySelector('#product-category').value,
    price: document.querySelector('#product-price').value.trim() || 'Confira na loja',
    description: document.querySelector('#product-description').value.trim(),
    image: document.querySelector('#product-image').value.trim(),
    tag: document.querySelector('#product-tag').value,
    id: `${Date.now()}`
  };
}
document.querySelector('#save-draft').addEventListener('click', () => {
  const product = collectProduct();
  if (!product) return showToast('Gere uma postagem antes de salvar.');
  saveProducts(draftProductsKey, [...getStoredProducts(draftProductsKey), product]);
  renderAdminProducts();
  showToast('Rascunho salvo no painel.');
});
document.querySelector('#publish-product').addEventListener('click', async () => {
  const product = collectProduct();
  if (!product) return showToast('Gere uma postagem antes de publicar.');
  try {
    const response = await fetch(apiUrl('/api/products'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product)
    });
    if (response.ok) {
      const savedProduct = await response.json();
      product.id = savedProduct.id;
    }
  } catch (error) {
    console.warn('Backend indisponível; mantendo o produto nesta sessão do navegador.', error);
  }
  saveProducts(publishedProductsKey, [...getStoredProducts(publishedProductsKey), product]);
  renderAdminProducts();
  renderPublishedCards();
  document.querySelector('#product-form').reset();
  generatedFields.hidden = true;
  generatedProduct = null;
  closeAdminModals();
  document.querySelector('#achadinhos').scrollIntoView({ behavior: 'smooth' });
  showToast('Postagem publicada no catálogo ✦');
});
renderPublishedCards();
