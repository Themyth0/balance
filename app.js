/**
 * ============================================================
 * Balance & Precios - Gestor de Artículos de Importación
 * app.js - Lógica completa de negocio, IndexedDB, Divisas y Calc
 * ============================================================
 */

// Estado global de la aplicación
const AppState = {
  articles: [],
  exchangeRate: 7.80, // 1 EUR = 7.80 RMB por defecto
  rateLastUpdated: 'Predeterminado',
  currentTheme: 'light',
  currentView: 'grid', // 'grid' | 'table'
  searchTerm: '',
  filterCategory: 'ALL',
  filterStatus: 'ALL',
  sortBy: 'date_desc',
  editingArticleId: null,
  currentPhoto: null, // { type: 'file'|'url', data: string, name: string }
  marketPrices: [] // Array de { id, source, price }
};

// ============================================================
// 1. BASE DE DATOS LOCAL (IndexedDB)
// ============================================================
const DB_NAME = 'ImportCalcDB';
const DB_VERSION = 1;
let dbInstance = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('articles')) {
        const articleStore = db.createObjectStore('articles', { keyPath: 'id' });
        articleStore.createIndex('category', 'category', { unique: false });
        articleStore.createIndex('status', 'status', { unique: false });
        articleStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => {
      console.error('Error al abrir IndexedDB:', e);
      reject(e);
    };
  });
}

function dbGetAllArticles() {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('articles', 'readonly');
    const store = tx.objectStore('articles');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e);
  });
}

function dbSaveArticle(article) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('articles', 'readwrite');
    const store = tx.objectStore('articles');
    const request = store.put(article);
    request.onsuccess = () => resolve(article);
    request.onerror = (e) => reject(e);
  });
}

function dbDeleteArticle(id) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('articles', 'readwrite');
    const store = tx.objectStore('articles');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

function dbClearAllArticles() {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('articles', 'readwrite');
    const store = tx.objectStore('articles');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

function dbGetConfig(key, defaultValue = null) {
  return new Promise((resolve) => {
    if (!dbInstance) return resolve(defaultValue);
    const tx = dbInstance.transaction('config', 'readonly');
    const store = tx.objectStore('config');
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : defaultValue);
    request.onerror = () => resolve(defaultValue);
  });
}

function dbSetConfig(key, value) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('config', 'readwrite');
    const store = tx.objectStore('config');
    const request = store.put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

// ============================================================
// 2. INICIALIZACIÓN DE LA APLICACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDatabase();

    // Cargar configuración guardada
    const savedRate = await dbGetConfig('exchangeRate', 7.80);
    const savedRateDate = await dbGetConfig('rateLastUpdated', 'Predeterminado');
    const savedTheme = await dbGetConfig('theme', 'light');

    AppState.exchangeRate = parseFloat(savedRate) || 7.80;
    AppState.rateLastUpdated = savedRateDate;
    AppState.currentTheme = savedTheme;

    applyTheme(AppState.currentTheme);
    updateTickerDisplay();

    // Cargar artículos
    const articles = await dbGetAllArticles();
    if (articles.length === 0) {
      // Cargar ejemplos de demostración la primera vez
      await loadDemoData();
    } else {
      AppState.articles = articles;
      renderArticles();
    }

    setupEventListeners();
    setupQuickCalc();
  } catch (error) {
    console.error('Error al inicializar la aplicación:', error);
    showToast('Error al inicializar la base de datos local', 'error');
  }
});

// ============================================================
// 3. GESTIÓN DE TEMA (CLARO / OSCURO)
// ============================================================
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  const btn = document.getElementById('btnThemeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
  }
}

function toggleTheme() {
  AppState.currentTheme = AppState.currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(AppState.currentTheme);
  dbSetConfig('theme', AppState.currentTheme);
}

// ============================================================
// 4. DIVISAS: CONVERSIÓN RMB ⇄ EUR
// ============================================================
function updateTickerDisplay() {
  const rateVal = AppState.exchangeRate.toFixed(2);
  document.getElementById('tickerRate').textContent = rateVal;
  document.getElementById('formRateDisplay').textContent = rateVal;
  document.querySelectorAll('.calc-rate-ref').forEach(el => el.textContent = rateVal);

  const updatedEl = document.getElementById('tickerUpdated');
  if (updatedEl) {
    updatedEl.textContent = AppState.rateLastUpdated === 'Predeterminado' ? '7.80' : AppState.rateLastUpdated;
  }
}

async function fetchLiveExchangeRate() {
  const btn = document.getElementById('btnFetchRateOnline');
  const btnRefresh = document.getElementById('btnRefreshRate');
  if (btn) btn.textContent = '⏳ Consultando...';
  if (btnRefresh) btnRefresh.style.animation = 'spin 1s infinite linear';

  try {
    // Intentamos consultar Frankfurter API (BCE oficial)
    const response = await fetch('https://api.frankfurter.app/latest?from=EUR&to=CNY');
    if (!response.ok) throw new Error('Error al conectar con la API de divisas');
    
    const data = await response.json();
    if (data && data.rates && data.rates.CNY) {
      const liveRate = parseFloat(data.rates.CNY);
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      
      AppState.exchangeRate = liveRate;
      AppState.rateLastUpdated = dateStr;

      await dbSetConfig('exchangeRate', liveRate);
      await dbSetConfig('rateLastUpdated', dateStr);

      document.getElementById('inputCustomRate').value = liveRate.toFixed(3);
      document.getElementById('rateLastUpdatedText').textContent = `${dateStr} (Oficial BCE)`;
      updateTickerDisplay();
      updateRateModalPreviews();
      recalculateModalForm();

      showToast(`Tipo de cambio actualizado: 1 € = ${liveRate.toFixed(3)} ¥`, 'success');
    }
  } catch (error) {
    console.warn('Fallo Frankfurter, probando alternativa:', error);
    try {
      const altResp = await fetch('https://open.er-api.com/v6/latest/EUR');
      const altData = await altResp.json();
      if (altData && altData.rates && altData.rates.CNY) {
        const liveRate = parseFloat(altData.rates.CNY);
        const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        AppState.exchangeRate = liveRate;
        AppState.rateLastUpdated = dateStr;

        await dbSetConfig('exchangeRate', liveRate);
        await dbSetConfig('rateLastUpdated', dateStr);

        document.getElementById('inputCustomRate').value = liveRate.toFixed(3);
        document.getElementById('rateLastUpdatedText').textContent = `${dateStr} (Mercado)`;
        updateTickerDisplay();
        updateRateModalPreviews();
        recalculateModalForm();

        showToast(`Tipo de cambio actualizado: 1 € = ${liveRate.toFixed(3)} ¥`, 'success');
      } else {
        throw new Error('Sin datos en API alternativa');
      }
    } catch (e2) {
      showToast('No se pudo conectar con la API de cambio. Comprueba tu conexión a internet.', 'error');
    }
  } finally {
    if (btn) btn.textContent = '🌐 Obtener cambio oficial en directo';
    if (btnRefresh) btnRefresh.style.animation = 'none';
  }
}

function updateRateModalPreviews() {
  const rate = parseFloat(document.getElementById('inputCustomRate').value) || AppState.exchangeRate;
  document.getElementById('previewRmbToEur').textContent = (100 / rate).toFixed(2) + ' €';
  document.getElementById('preview500RmbToEur').textContent = (500 / rate).toFixed(2) + ' €';
  document.getElementById('previewEurToRmb').textContent = '¥ ' + (10 * rate).toFixed(2) + ' RMB';
}

// ============================================================
// 5. RENDERIZADO DE ARTÍCULOS Y KPIS
// ============================================================
function renderArticles() {
  const gridContainer = document.getElementById('articlesGrid');
  const tableBody = document.getElementById('articlesTableBody');
  const emptyState = document.getElementById('emptyState');
  const tableView = document.getElementById('articlesTableView');

  // Filtrado y Ordenación
  let filtered = [...AppState.articles];

  // Búsqueda
  if (AppState.searchTerm.trim() !== '') {
    const term = AppState.searchTerm.toLowerCase().trim();
    filtered = filtered.filter(a => 
      a.name.toLowerCase().includes(term) ||
      (a.category && a.category.toLowerCase().includes(term)) ||
      (a.notes && a.notes.toLowerCase().includes(term))
    );
  }

  // Filtro Categoría
  if (AppState.filterCategory !== 'ALL') {
    filtered = filtered.filter(a => a.category === AppState.filterCategory);
  }

  // Filtro Estado
  if (AppState.filterStatus !== 'ALL') {
    filtered = filtered.filter(a => a.status === AppState.filterStatus);
  }

  // Ordenación
  filtered.sort((a, b) => {
    switch (AppState.sortBy) {
      case 'date_desc': return (b.createdAt || 0) - (a.createdAt || 0);
      case 'margin_desc': return b.marginPercent - a.marginPercent;
      case 'profit_desc': return b.netProfit - a.netProfit;
      case 'cost_asc': return a.totalCostEUR - b.totalCostEUR;
      case 'name_asc': return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  // Actualizar categorías en el desplegable
  updateCategoryDropdown();

  // Actualizar KPIs globales
  updateGlobalKPIs();

  // Si no hay artículos tras el filtro
  if (filtered.length === 0) {
    gridContainer.innerHTML = '';
    tableBody.innerHTML = '';
    emptyState.style.display = 'block';
    if (AppState.currentView === 'table') tableView.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';

  if (AppState.currentView === 'grid') {
    gridContainer.style.display = 'grid';
    tableView.style.display = 'none';
    renderGridView(filtered, gridContainer);
  } else {
    gridContainer.style.display = 'none';
    tableView.style.display = 'block';
    renderTableView(filtered, tableBody);
  }
}

function renderGridView(articles, container) {
  container.innerHTML = articles.map(article => {
    const statusLabels = {
      EN_ESTUDIO: '💡 En estudio',
      COMPRADO: '📦 Comprado',
      EN_VENTA: '🏷️ En venta',
      VENDIDO: '✅ Vendido',
      DESCARTADO: '❌ Descartado'
    };

    const qty = article.quantity || 1;
    const batchCost = (article.totalCostEUR || 0) * qty;
    const batchRevenue = (article.finalPrice || 0) * qty;
    const batchProfit = (article.netProfit || 0) * qty;

    const isProfitPositive = article.netProfit >= 0;
    const profitClass = isProfitPositive ? 'profit-positive' : 'profit-negative';

    const photoSrc = article.photo ? article.photo.data : '';
    const imageHtml = photoSrc 
      ? `<img src="${photoSrc}" alt="${escapeHtml(article.name)}" class="card-img" onclick="openLightbox('${photoSrc}', '${escapeHtml(article.name)}')">`
      : `<div class="card-img-placeholder">📦</div>`;

    // Comparación vs media
    let marketCompHtml = '';
    if (article.marketAverage > 0) {
      const diff = article.finalPrice - article.marketAverage;
      const diffText = diff >= 0 ? `+${diff.toFixed(2)}€ vs media` : `${diff.toFixed(2)}€ vs media`;
      marketCompHtml = `<span class="pill-tag">${diffText}</span>`;
    }

    return `
      <article class="article-card" data-id="${article.id}">
        <div class="card-media">
          ${imageHtml}
          <span class="card-badge-status status-${article.status}">
            ${statusLabels[article.status] || article.status}
          </span>
          <span class="card-badge-qty">📦 ${qty} uds</span>
          ${article.category ? `<span class="card-badge-category">${escapeHtml(article.category)}</span>` : ''}
        </div>

        <div class="card-content">
          <h3 class="card-title" title="${escapeHtml(article.name)}">${escapeHtml(article.name)}</h3>

          <div class="card-pricing-table">
            <div class="pricing-row">
              <span class="pricing-label">Coste Compra:</span>
              <span class="pricing-value">
                ${article.costEUR.toFixed(2)} €/ud 
                <span class="pricing-value rmb">(¥${article.costRMB.toFixed(2)})</span>
              </span>
            </div>

            <div class="pricing-row">
              <span class="pricing-label">Inversión Lote (${qty} uds):</span>
              <span class="pricing-value accent">${batchCost.toFixed(2)} € <small class="text-muted">(${article.totalCostEUR.toFixed(2)}€/ud)</small></span>
            </div>

            <div class="pricing-divider"></div>

            <div class="pricing-row">
              <span class="pricing-label">Media Mercado:</span>
              <span class="pricing-value">${article.marketAverage > 0 ? article.marketAverage.toFixed(2) + ' €' : 'Sin datos'}</span>
            </div>
            ${(article.priceEbay > 0 || article.priceWallapop > 0 || article.priceVinted > 0) ? `
            <div class="card-market-breakdown">
              ${article.priceEbay > 0 ? `<span class="platform-chip ebay">eBay ${article.priceEbay.toFixed(2)}€</span>` : ''}
              ${article.priceWallapop > 0 ? `<span class="platform-chip wallapop">Wallapop ${article.priceWallapop.toFixed(2)}€</span>` : ''}
              ${article.priceVinted > 0 ? `<span class="platform-chip vinted">Vinted ${article.priceVinted.toFixed(2)}€</span>` : ''}
            </div>` : ''}

            <div class="pricing-row">
              <span class="pricing-label">P. Venta Final:</span>
              <span class="pricing-value" style="font-size: 1.02rem; font-weight: 700; color: var(--primary);">
                ${article.finalPrice.toFixed(2)} €/ud 
                <small class="text-muted">(Total: ${batchRevenue.toFixed(2)}€)</small>
              </span>
            </div>
          </div>

          <div class="card-profit-box ${profitClass}">
            <div class="profit-primary">
              <span class="profit-val">${batchProfit >= 0 ? '+' : ''}${batchProfit.toFixed(2)} €</span>
              <span class="profit-lbl">Ganancia Lote (${batchProfit >= 0 ? '+' : ''}${article.netProfit.toFixed(2)} €/ud)</span>
            </div>
            <div class="profit-badges-group">
              <span class="pill-tag">Margen: ${article.marginPercent.toFixed(1)}%</span>
              <span class="pill-tag">ROI: ${article.roi.toFixed(1)}%</span>
              ${marketCompHtml}
            </div>
          </div>
        </div>

        <div class="card-footer">
          <small class="text-muted">Tasa: 1€ = ${article.rateApplied ? article.rateApplied.toFixed(2) : AppState.exchangeRate.toFixed(2)}¥</small>
          <div class="card-actions-group">
            <button class="btn-card-action" onclick="editArticle('${article.id}')" title="Editar">✏️ Editar</button>
            <button class="btn-card-action" onclick="duplicateArticle('${article.id}')" title="Duplicar">📑</button>
            <button class="btn-card-action danger" onclick="confirmDeleteArticle('${article.id}')" title="Eliminar">🗑️</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderTableView(articles, tbody) {
  const statusLabels = {
    EN_ESTUDIO: '💡 En estudio',
    COMPRADO: '📦 Comprado',
    EN_VENTA: '🏷️ En venta',
    VENDIDO: '✅ Vendido',
    DESCARTADO: '❌ Descartado'
  };

  tbody.innerHTML = articles.map(article => {
    const photoSrc = article.photo ? article.photo.data : '';
    const imgHtml = photoSrc
      ? `<img src="${photoSrc}" class="table-thumb" alt="Foto" onclick="openLightbox('${photoSrc}', '${escapeHtml(article.name)}')">`
      : `<div class="table-thumb-placeholder">📦</div>`;

    const qty = article.quantity || 1;
    const batchCost = (article.totalCostEUR || 0) * qty;
    const batchRevenue = (article.finalPrice || 0) * qty;
    const batchProfit = (article.netProfit || 0) * qty;

    const profitColor = batchProfit >= 0 ? 'var(--success)' : 'var(--danger)';

    return `
      <tr>
        <td>${imgHtml}</td>
        <td>
          <div class="table-item-name">${escapeHtml(article.name)}</div>
          ${article.notes ? `<small class="text-muted">${escapeHtml(article.notes.substring(0, 45))}${article.notes.length > 45 ? '...' : ''}</small>` : ''}
        </td>
        <td><span class="pill-tag">${escapeHtml(article.category || 'General')}</span></td>
        <td><span class="card-badge-status status-${article.status}">${statusLabels[article.status] || article.status}</span></td>
        <td><span class="pill-tag" style="font-weight: 700; font-size: 0.82rem;">${qty} uds</span></td>
        <td>${article.totalCostEUR.toFixed(2)} €</td>
        <td><strong style="color: var(--warning-text);">${batchCost.toFixed(2)} €</strong></td>
        <td>${article.priceEbay > 0 ? `<span class="platform-chip ebay">eBay ${article.priceEbay.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td>${article.priceWallapop > 0 ? `<span class="platform-chip wallapop">Wallp. ${article.priceWallapop.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td>${article.priceVinted > 0 ? `<span class="platform-chip vinted">Vinted ${article.priceVinted.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td>${article.marketAverage > 0 ? article.marketAverage.toFixed(2) + ' €' : '—'}</td>
        <td style="font-weight: 700; color: var(--brand);">${article.finalPrice.toFixed(2)} €</td>
        <td><strong>${batchRevenue.toFixed(2)} €</strong></td>
        <td style="font-weight: 700; color: ${profitColor};">
          ${batchProfit >= 0 ? '+' : ''}${batchProfit.toFixed(2)} €
          <br><small class="text-muted">(${article.netProfit >= 0 ? '+' : ''}${article.netProfit.toFixed(2)} €/ud)</small>
        </td>
        <td>
          <span class="pill-tag" style="font-weight: 700;">${article.marginPercent.toFixed(1)}%</span>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-card-action" onclick="editArticle('${article.id}')" title="Editar">✏️</button>
            <button class="btn-card-action danger" onclick="confirmDeleteArticle('${article.id}')" title="Eliminar">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateGlobalKPIs() {
  const articles = AppState.articles;
  const count = articles.length;

  let totalUnits = 0;
  let totalCostEUR = 0;
  let totalCostRMB = 0;
  let totalRevenue = 0;
  let totalProfit = 0;

  articles.forEach(a => {
    const qty = a.quantity || 1;
    totalUnits += qty;
    totalCostEUR += (a.totalCostEUR || 0) * qty;
    totalCostRMB += (a.costRMB || 0) * qty;
    totalRevenue += (a.finalPrice || 0) * qty;
    totalProfit += (a.netProfit || 0) * qty;
  });

  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const avgPrice = totalUnits > 0 ? totalRevenue / totalUnits : 0;

  document.getElementById('kpiTotalArticles').textContent = `${count} artículos (${totalUnits} uds)`;
  document.getElementById('kpiTotalCost').textContent = formatCurrency(totalCostEUR);
  document.getElementById('kpiTotalCostRMB').textContent = `¥ ${totalCostRMB.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RMB`;
  document.getElementById('kpiTotalRevenue').textContent = formatCurrency(totalRevenue);
  document.getElementById('kpiAveragePrice').textContent = `Media: ${formatCurrency(avgPrice)}/ud`;
  
  const profitEl = document.getElementById('kpiTotalProfit');
  profitEl.textContent = (totalProfit >= 0 ? '+' : '') + formatCurrency(totalProfit);
  profitEl.className = totalProfit >= 0 ? 'kpi-value green-text' : 'kpi-value text-danger';

  document.getElementById('kpiAverageMargin').textContent = `Margen medio: ${avgMargin.toFixed(1)}%`;
}

function updateCategoryDropdown() {
  const select = document.getElementById('filterCategory');
  const datalist = document.getElementById('categoriesList');
  const currentVal = select.value;

  const categories = new Set();
  AppState.articles.forEach(a => {
    if (a.category && a.category.trim()) categories.add(a.category.trim());
  });

  // Reconstruir select
  let html = '<option value="ALL">Todas las categorías</option>';
  categories.forEach(cat => {
    html += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
  });
  select.innerHTML = html;
  select.value = currentVal;

  // Reconstruir datalist del modal
  let datalistHtml = '';
  categories.forEach(cat => {
    datalistHtml += `<option value="${escapeHtml(cat)}"></option>`;
  });
  datalist.innerHTML = datalistHtml;
}

// ============================================================
// 6. FORMULARIO MODAL: CREAR / EDITAR ARTÍCULO
// ============================================================
function openArticleModal(article = null) {
  const form = document.getElementById('articleForm');
  form.reset();

  AppState.currentPhoto = null;
  AppState.marketPrices = [];
  hidePhotoPreview();

  if (article) {
    // Modo Edición
    AppState.editingArticleId = article.id;
    document.getElementById('modalArticleTitle').textContent = 'Editar Artículo';
    document.getElementById('articleId').value = article.id;
    document.getElementById('inputName').value = article.name;
    document.getElementById('inputCategory').value = article.category || '';
    document.getElementById('inputStatus').value = article.status || 'EN_VENTA';
    document.getElementById('inputQuantity').value = article.quantity || 1;
    document.getElementById('inputNotes').value = article.notes || '';

    // Costes
    document.getElementById('inputCostRMB').value = article.costRMB || '';
    document.getElementById('inputCostEUR').value = article.costEUR || '';
    document.getElementById('inputShippingCost').value = article.shippingCost || 0;
    document.getElementById('inputCustomsPercent').value = article.customsPercent || 0;
    document.getElementById('inputFeePercent').value = article.feePercent || 0;

    // Precios de plataformas específicas
    document.getElementById('inputPriceEbay').value = article.priceEbay || '';
    document.getElementById('inputPriceWallapop').value = article.priceWallapop || '';
    document.getElementById('inputPriceVinted').value = article.priceVinted || '';

    // Precios de mercado adicionales
    if (article.marketPrices && Array.isArray(article.marketPrices)) {
      AppState.marketPrices = JSON.parse(JSON.stringify(article.marketPrices));
    }

    // Precio final
    document.getElementById('inputFinalPrice').value = article.finalPrice || '';

    // Foto
    if (article.photo) {
      AppState.currentPhoto = { ...article.photo };
      showPhotoPreview(article.photo.data, article.photo.name || 'foto.jpg');
    }
  } else {
    // Modo Nuevo
    AppState.editingArticleId = null;
    document.getElementById('modalArticleTitle').textContent = 'Nuevo Artículo';
    document.getElementById('articleId').value = '';
    document.getElementById('inputStatus').value = 'EN_VENTA';
    document.getElementById('inputQuantity').value = 1;

    // Limpiar campos de plataformas
    document.getElementById('inputPriceEbay').value = '';
    document.getElementById('inputPriceWallapop').value = '';
    document.getElementById('inputPriceVinted').value = '';

    // Sin filas de mercado adicionales
    AppState.marketPrices = [];
  }

  renderMarketPriceRows();
  recalculateModalForm();

  document.getElementById('articleModal').style.display = 'flex';
  document.getElementById('inputName').focus();
}

function closeArticleModal() {
  document.getElementById('articleModal').style.display = 'none';
  AppState.editingArticleId = null;
  AppState.currentPhoto = null;
  AppState.marketPrices = [];
}

// Recalcular formulario en directo
function recalculateModalForm() {
  const rate = AppState.exchangeRate;

  const quantity = Math.max(1, parseInt(document.getElementById('inputQuantity').value) || 1);
  const costRMB = parseFloat(document.getElementById('inputCostRMB').value) || 0;
  const costEUR = parseFloat(document.getElementById('inputCostEUR').value) || 0;
  const shippingCost = parseFloat(document.getElementById('inputShippingCost').value) || 0;
  const customsPercent = parseFloat(document.getElementById('inputCustomsPercent').value) || 0;
  const feePercent = parseFloat(document.getElementById('inputFeePercent').value) || 0;
  const finalPrice = parseFloat(document.getElementById('inputFinalPrice').value) || 0;

  document.getElementById('displayQtyCostLabel').textContent = quantity;
  document.getElementById('displayQtyProfitLabel').textContent = quantity;

  // Coste real unitario
  const customsAmount = costEUR * (customsPercent / 100);
  const feeAmount = finalPrice * (feePercent / 100);
  const totalCostEUR = costEUR + shippingCost + customsAmount + feeAmount;

  // Coste total del lote
  const batchCost = totalCostEUR * quantity;

  document.getElementById('displayTotalCost').textContent = totalCostEUR.toFixed(2) + ' €';
  document.getElementById('displayBatchCost').textContent = batchCost.toFixed(2) + ' €';

  // Cálculos de Mercado: eBay, Wallapop, Vinted + precios adicionales
  const priceEbay = parseFloat(document.getElementById('inputPriceEbay').value) || 0;
  const priceWallapop = parseFloat(document.getElementById('inputPriceWallapop').value) || 0;
  const priceVinted = parseFloat(document.getElementById('inputPriceVinted').value) || 0;

  const platformPrices = [priceEbay, priceWallapop, priceVinted].filter(p => p > 0);
  const extraPrices = AppState.marketPrices
    .map(p => parseFloat(p.price))
    .filter(p => !isNaN(p) && p > 0);
  const validPrices = [...platformPrices, ...extraPrices];

  let marketAvg = 0;
  let marketMin = 0;
  let marketMax = 0;

  if (validPrices.length > 0) {
    const sum = validPrices.reduce((a, b) => a + b, 0);
    marketAvg = sum / validPrices.length;
    marketMin = Math.min(...validPrices);
    marketMax = Math.max(...validPrices);
  }

  document.getElementById('displayMarketAverage').textContent = marketAvg > 0 ? marketAvg.toFixed(2) + ' €' : '0,00 €';
  document.getElementById('displayMarketMin').textContent = marketMin > 0 ? marketMin.toFixed(2) + ' €' : '0,00 €';
  document.getElementById('displayMarketMax').textContent = marketMax > 0 ? marketMax.toFixed(2) + ' €' : '0,00 €';

  // Rentabilidad (Unitaria y Lote)
  const netProfit = finalPrice - totalCostEUR;
  const batchProfit = netProfit * quantity;
  const batchRevenue = finalPrice * quantity;
  const marginPercent = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
  const roi = totalCostEUR > 0 ? (netProfit / totalCostEUR) * 100 : 0;

  const profitBadge = document.getElementById('profitBadge');
  const batchProfitBadge = document.getElementById('batchProfitBadge');
  const netProfitEl = document.getElementById('displayNetProfit');
  const batchProfitEl = document.getElementById('displayBatchProfit');
  const marginEl = document.getElementById('displayMarginPercent');
  const roiEl = document.getElementById('displayROI');

  netProfitEl.textContent = (netProfit >= 0 ? '+' : '') + netProfit.toFixed(2) + ' €';
  batchProfitEl.textContent = (batchProfit >= 0 ? '+' : '') + batchProfit.toFixed(2) + ' €';
  marginEl.textContent = marginPercent.toFixed(1) + '%';
  roiEl.textContent = roi.toFixed(1) + '%';

  // Coloreado visual de rentabilidad
  if (finalPrice > 0) {
    const color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    profitBadge.style.borderColor = color;
    netProfitEl.style.color = color;
    batchProfitBadge.style.borderColor = color;
    batchProfitEl.style.color = color;
  } else {
    profitBadge.style.borderColor = 'var(--border-color)';
    netProfitEl.style.color = 'var(--text-main)';
    batchProfitBadge.style.borderColor = 'var(--primary)';
    batchProfitEl.style.color = 'var(--text-main)';
  }

  // Resumen financiero del lote
  const summaryEl = document.getElementById('batchFinancialSummary');
  if (finalPrice > 0) {
    const profitColor = batchProfit >= 0 ? 'var(--success-text)' : 'var(--danger-text)';
    summaryEl.innerHTML = `📊 <strong>Cuentas del Lote Completo (${quantity} uds):</strong> Inversión: <strong>${batchCost.toFixed(2)} €</strong> | Facturación: <strong>${batchRevenue.toFixed(2)} €</strong> | Ganancia limpia total: <strong style="color: ${profitColor};">${batchProfit >= 0 ? '+' : ''}${batchProfit.toFixed(2)} €</strong>`;
    summaryEl.style.display = 'block';
  } else {
    summaryEl.style.display = 'none';
  }

  // Comparativa vs Media
  const noteEl = document.getElementById('vsMarketNote');
  if (finalPrice > 0 && marketAvg > 0) {
    const diff = finalPrice - marketAvg;
    if (Math.abs(diff) < 0.05) {
      noteEl.textContent = '⚖️ Tu precio es exactamente igual a la media de mercado.';
      noteEl.style.color = 'var(--primary)';
    } else if (diff < 0) {
      noteEl.textContent = `🟢 ¡Precio competitivo! Estás ${Math.abs(diff).toFixed(2)} € por debajo de la media (${marketAvg.toFixed(2)} €).`;
      noteEl.style.color = 'var(--success-text)';
    } else {
      noteEl.textContent = `🟡 Estás ${diff.toFixed(2)} € por encima de la media de mercado (${marketAvg.toFixed(2)} €).`;
      noteEl.style.color = 'var(--warning-text)';
    }
  } else {
    noteEl.textContent = 'Introduce el precio final para comparar con la media de mercado.';
    noteEl.style.color = 'var(--text-muted)';
  }
}

// Manejo de filas de precios de referencia
function renderMarketPriceRows() {
  const container = document.getElementById('marketPricesList');
  container.innerHTML = AppState.marketPrices.map((item, index) => `
    <div class="market-price-row" data-id="${item.id}">
      <input type="text" class="market-price-source" value="${escapeHtml(item.source)}" placeholder="Ej: Amazon / Wallapop" onchange="updateMarketPriceItem('${item.id}', 'source', this.value)">
      <div class="input-prefix-container market-price-val">
        <span class="input-prefix">€</span>
        <input type="number" step="0.01" min="0" value="${item.price}" placeholder="0.00" oninput="updateMarketPriceItem('${item.id}', 'price', this.value)">
      </div>
      <button type="button" class="btn-remove-row" onclick="removeMarketPriceRow('${item.id}')" title="Quitar">✕</button>
    </div>
  `).join('');
}

function addMarketPriceRow() {
  AppState.marketPrices.push({
    id: Date.now().toString(),
    source: '',
    price: ''
  });
  renderMarketPriceRows();
}

function removeMarketPriceRow(id) {
  AppState.marketPrices = AppState.marketPrices.filter(p => p.id !== id);
  renderMarketPriceRows();
  recalculateModalForm();
}

function updateMarketPriceItem(id, field, value) {
  const item = AppState.marketPrices.find(p => p.id === id);
  if (item) {
    item[field] = value;
    if (field === 'price') {
      recalculateModalForm();
    }
  }
}

// ============================================================
// 7. GESTIÓN DE FOTOS (SUBIDA LOCAL & URL)
// ============================================================
function showPhotoPreview(dataUrl, name) {
  const container = document.getElementById('photoPreviewContainer');
  const img = document.getElementById('photoPreviewImg');
  const nameEl = document.getElementById('photoPreviewName');

  img.src = dataUrl;
  nameEl.textContent = name || 'Fotografía seleccionada';
  container.style.display = 'flex';
}

function hidePhotoPreview() {
  const container = document.getElementById('photoPreviewContainer');
  const img = document.getElementById('photoPreviewImg');
  img.src = '';
  container.style.display = 'none';
  AppState.currentPhoto = null;
}

function handleFileUpload(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Por favor, selecciona un archivo de imagen válido (JPG, PNG, WEBP).', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    // Redimensionar imagen en el cliente para mantener alta resolución pero optimizar tamaño
    compressImage(e.target.result, 1200, 1200, 0.85, (compressedDataUrl) => {
      AppState.currentPhoto = {
        type: 'file',
        name: file.name,
        data: compressedDataUrl
      };
      showPhotoPreview(compressedDataUrl, file.name);
      showToast('Foto cargada con éxito', 'success');
    });
  };
  reader.readAsDataURL(file);
}

function compressImage(src, maxWidth, maxHeight, quality, callback) {
  const img = new Image();
  img.src = src;
  img.onload = () => {
    let width = img.width;
    let height = img.height;

    if (width > maxWidth || height > maxHeight) {
      if (width > height) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      } else {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => {
    // Fallback: usar original si no se puede procesar en canvas
    callback(src);
  };
}

// ============================================================
// 8. GUARDAR Y GESTIONAR ARTÍCULOS
// ============================================================
async function saveArticleHandler(e) {
  e.preventDefault();

  const name = document.getElementById('inputName').value.trim();
  if (!name) {
    showToast('El nombre del artículo es obligatorio.', 'error');
    return;
  }

  const quantity = Math.max(1, parseInt(document.getElementById('inputQuantity').value) || 1);
  const costRMB = parseFloat(document.getElementById('inputCostRMB').value) || 0;
  const costEUR = parseFloat(document.getElementById('inputCostEUR').value) || 0;
  const shippingCost = parseFloat(document.getElementById('inputShippingCost').value) || 0;
  const customsPercent = parseFloat(document.getElementById('inputCustomsPercent').value) || 0;
  const feePercent = parseFloat(document.getElementById('inputFeePercent').value) || 0;
  const finalPrice = parseFloat(document.getElementById('inputFinalPrice').value) || 0;

  const customsAmount = costEUR * (customsPercent / 100);
  const feeAmount = finalPrice * (feePercent / 100);
  const totalCostEUR = costEUR + shippingCost + customsAmount + feeAmount;

  // Precios de plataformas específicas
  const priceEbay = parseFloat(document.getElementById('inputPriceEbay').value) || 0;
  const priceWallapop = parseFloat(document.getElementById('inputPriceWallapop').value) || 0;
  const priceVinted = parseFloat(document.getElementById('inputPriceVinted').value) || 0;

  // Cálculos de Mercado: plataformas fijas + precios adicionales
  const platformPrices = [priceEbay, priceWallapop, priceVinted].filter(p => p > 0);
  const extraPrices = AppState.marketPrices
    .map(p => parseFloat(p.price))
    .filter(p => !isNaN(p) && p > 0);
  const validPrices = [...platformPrices, ...extraPrices];

  let marketAvg = 0;
  let marketMin = 0;
  let marketMax = 0;
  if (validPrices.length > 0) {
    marketAvg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
    marketMin = Math.min(...validPrices);
    marketMax = Math.max(...validPrices);
  }

  const netProfit = finalPrice - totalCostEUR;
  const marginPercent = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
  const roi = totalCostEUR > 0 ? (netProfit / totalCostEUR) * 100 : 0;

  const articleData = {
    id: AppState.editingArticleId || Date.now().toString(),
    name,
    category: document.getElementById('inputCategory').value.trim() || 'General',
    status: document.getElementById('inputStatus').value,
    quantity,
    notes: document.getElementById('inputNotes').value.trim(),
    costRMB,
    costEUR,
    shippingCost,
    customsPercent,
    feePercent,
    totalCostEUR,
    totalBatchCostEUR: totalCostEUR * quantity,
    totalBatchRevenue: finalPrice * quantity,
    totalBatchProfit: netProfit * quantity,
    priceEbay,
    priceWallapop,
    priceVinted,
    marketPrices: AppState.marketPrices.filter(p => p.source.trim() || p.price),
    marketAverage: marketAvg,
    marketMin,
    marketMax,
    finalPrice,
    netProfit,
    marginPercent,
    roi,
    rateApplied: AppState.exchangeRate,
    photo: AppState.currentPhoto,
    createdAt: AppState.editingArticleId 
      ? (AppState.articles.find(a => a.id === AppState.editingArticleId)?.createdAt || Date.now())
      : Date.now(),
    updatedAt: Date.now()
  };

  try {
    await dbSaveArticle(articleData);

    const existingIndex = AppState.articles.findIndex(a => a.id === articleData.id);
    if (existingIndex >= 0) {
      AppState.articles[existingIndex] = articleData;
      showToast('Artículo actualizado correctamente', 'success');
    } else {
      AppState.articles.unshift(articleData);
      showToast('Artículo guardado correctamente', 'success');
    }

    closeArticleModal();
    renderArticles();
  } catch (error) {
    console.error('Error al guardar artículo:', error);
    showToast('Error al guardar el artículo en la base de datos', 'error');
  }
}

function editArticle(id) {
  const article = AppState.articles.find(a => a.id === id);
  if (article) {
    openArticleModal(article);
  }
}

async function duplicateArticle(id) {
  const article = AppState.articles.find(a => a.id === id);
  if (!article) return;

  const duplicated = {
    ...JSON.parse(JSON.stringify(article)),
    id: Date.now().toString(),
    name: `${article.name} (Copia)`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  try {
    await dbSaveArticle(duplicated);
    AppState.articles.unshift(duplicated);
    renderArticles();
    showToast('Artículo duplicado con éxito', 'success');
  } catch (e) {
    showToast('Error al duplicar el artículo', 'error');
  }
}

async function confirmDeleteArticle(id) {
  const article = AppState.articles.find(a => a.id === id);
  const name = article ? article.name : 'este artículo';

  if (confirm(`¿Estás seguro de que deseas eliminar "${name}"?`)) {
    try {
      await dbDeleteArticle(id);
      AppState.articles = AppState.articles.filter(a => a.id !== id);
      renderArticles();
      showToast('Artículo eliminado', 'info');
    } catch (e) {
      showToast('Error al eliminar el artículo', 'error');
    }
  }
}

// ============================================================
// 9. EXPORTACIÓN A LIBREOFFICE CALC (.ODS, .XLSX, .CSV)
// ============================================================
function exportToCalc(format = 'ods') {
  if (AppState.articles.length === 0) {
    showToast('No hay artículos en el catálogo para exportar.', 'warning');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showToast('Cargando librería de hojas de cálculo... Inténtalo de nuevo en un instante.', 'error');
    return;
  }

  try {
    // Formatear filas para LibreOffice Calc
    const rows = AppState.articles.map((a, index) => {
      const qty = a.quantity || 1;
      const batchCost = (a.totalCostEUR || 0) * qty;
      const batchRevenue = (a.finalPrice || 0) * qty;
      const batchProfit = (a.netProfit || 0) * qty;

      return {
        'Nº': index + 1,
        'Artículo': a.name,
        'Categoría': a.category || 'General',
        'Estado': a.status,
        'Cantidad (Uds)': qty,
        'Coste (¥ RMB)': Number(a.costRMB.toFixed(2)),
        'Tipo Cambio (¥/€)': Number((a.rateApplied || AppState.exchangeRate).toFixed(2)),
        'Coste Base (€)': Number(a.costEUR.toFixed(2)),
        'Envío Unitario (€)': Number((a.shippingCost || 0).toFixed(2)),
        'Aduanas/IVA (%)': Number((a.customsPercent || 0).toFixed(1)),
        'Comisión Venta (%)': Number((a.feePercent || 0).toFixed(1)),
        'Coste Unit. Real (€)': Number(a.totalCostEUR.toFixed(2)),
        'Inversión Total Lote (€)': Number(batchCost.toFixed(2)),
        'Precio eBay (€)': a.priceEbay > 0 ? Number(a.priceEbay.toFixed(2)) : 0,
        'Precio Wallapop (€)': a.priceWallapop > 0 ? Number(a.priceWallapop.toFixed(2)) : 0,
        'Precio Vinted (€)': a.priceVinted > 0 ? Number(a.priceVinted.toFixed(2)) : 0,
        'Media Mercado (€)': a.marketAverage > 0 ? Number(a.marketAverage.toFixed(2)) : 0,
        'Precio Venta Unit. (€)': Number(a.finalPrice.toFixed(2)),
        'Venta Total Lote (€)': Number(batchRevenue.toFixed(2)),
        'Beneficio Unit. (€)': Number(a.netProfit.toFixed(2)),
        'Beneficio Total Lote (€)': Number(batchProfit.toFixed(2)),
        'Margen (%)': Number(a.marginPercent.toFixed(1)),
        'Retorno ROI (%)': Number(a.roi.toFixed(1)),
        'Foto (Tipo/Enlace)': a.photo ? (a.photo.type === 'url' ? a.photo.data : 'Foto local guardada') : 'Sin foto',
        'Fecha Registro': new Date(a.createdAt).toLocaleDateString('es-ES'),
        'Notas': a.notes || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Ajustar anchos de columnas para una lectura perfecta en Calc
    worksheet['!cols'] = [
      { wch: 5 },  // Nº
      { wch: 32 }, // Artículo
      { wch: 18 }, // Categoría
      { wch: 14 }, // Estado
      { wch: 14 }, // Cantidad Uds
      { wch: 14 }, // Coste RMB
      { wch: 16 }, // Tipo Cambio
      { wch: 14 }, // Coste EUR
      { wch: 16 }, // Envío
      { wch: 15 }, // Aduanas %
      { wch: 16 }, // Comisiones %
      { wch: 18 }, // Coste Unit Real
      { wch: 20 }, // Inversión Total Lote
      { wch: 16 }, // Precio eBay
      { wch: 18 }, // Precio Wallapop
      { wch: 16 }, // Precio Vinted
      { wch: 18 }, // Media Mercado
      { wch: 20 }, // Precio Venta Unit
      { wch: 20 }, // Venta Total Lote
      { wch: 18 }, // Beneficio Unit
      { wch: 20 }, // Beneficio Total Lote
      { wch: 13 }, // Margen %
      { wch: 14 }, // ROI %
      { wch: 25 }, // Foto
      { wch: 14 }, // Fecha
      { wch: 30 }  // Notas
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Artículos Importación');

    // Nombre del archivo con fecha de hoy
    const today = new Date().toISOString().split('T')[0];
    let filename = `Articulos_Importacion_Calc_${today}`;

    if (format === 'ods') {
      filename += '.ods';
      XLSX.writeFile(workbook, filename, { bookType: 'ods' });
      showToast('Hojas de cálculo generada: ' + filename + ' (Abrir con LibreOffice Calc)', 'success');
    } else if (format === 'xlsx') {
      filename += '.xlsx';
      XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
      showToast('Archivo Excel/Calc generado: ' + filename, 'success');
    } else if (format === 'csv') {
      filename += '.csv';
      XLSX.writeFile(workbook, filename, { bookType: 'csv' });
      showToast('Archivo CSV generado: ' + filename, 'success');
    }

    // Cerrar menú desplegable
    document.getElementById('exportDropdown').parentElement.classList.remove('open');
  } catch (error) {
    console.error('Error al exportar a LibreOffice Calc:', error);
    showToast('Error al generar la hoja de cálculo: ' + error.message, 'error');
  }
}

// ============================================================
// 10. CALCULADORA RÁPIDA RMB ⇄ EUR
// ============================================================
function setupQuickCalc() {
  const quickRmb = document.getElementById('quickRmb');
  const quickEur = document.getElementById('quickEur');
  const chipsGrid = document.getElementById('quickChipsGrid');

  if (!quickRmb || !quickEur) return;

  quickRmb.addEventListener('input', () => {
    const val = parseFloat(quickRmb.value);
    if (!isNaN(val) && val >= 0) {
      quickEur.value = (val / AppState.exchangeRate).toFixed(2);
    } else {
      quickEur.value = '';
    }
  });

  quickEur.addEventListener('input', () => {
    const val = parseFloat(quickEur.value);
    if (!isNaN(val) && val >= 0) {
      quickRmb.value = (val * AppState.exchangeRate).toFixed(1);
    } else {
      quickRmb.value = '';
    }
  });

  // Fichas rápidas de importes habituales
  const commonAmounts = [10, 20, 50, 100, 200, 500];
  chipsGrid.innerHTML = commonAmounts.map(rmb => {
    const eur = (rmb / AppState.exchangeRate).toFixed(2);
    return `
      <div class="quick-chip" onclick="setQuickCalcValue(${rmb})">
        <span>¥${rmb}</span> = <strong>${eur}€</strong>
      </div>
    `;
  }).join('');
}

window.setQuickCalcValue = function(rmb) {
  document.getElementById('quickRmb').value = rmb;
  document.getElementById('quickEur').value = (rmb / AppState.exchangeRate).toFixed(2);
};

// ============================================================
// 11. COPIA DE SEGURIDAD (JSON EXPORT / IMPORT)
// ============================================================
function downloadBackup() {
  const backupData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    exchangeRate: AppState.exchangeRate,
    rateLastUpdated: AppState.rateLastUpdated,
    articles: AppState.articles
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Copia_Seguridad_Articulos_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada con éxito', 'success');
}

function handleRestoreBackup(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.articles || !Array.isArray(data.articles)) {
        throw new Error('El archivo no contiene un catálogo válido.');
      }

      if (confirm(`Se han encontrado ${data.articles.length} artículos en la copia. ¿Deseas importarlos? (Se combinarán con los existentes)`)) {
        for (const item of data.articles) {
          await dbSaveArticle(item);
        }

        if (data.exchangeRate) {
          AppState.exchangeRate = parseFloat(data.exchangeRate);
          await dbSetConfig('exchangeRate', AppState.exchangeRate);
        }

        AppState.articles = await dbGetAllArticles();
        renderArticles();
        updateTickerDisplay();
        document.getElementById('backupModal').style.display = 'none';
        showToast('Copia de seguridad restaurada correctamente', 'success');
      }
    } catch (err) {
      showToast('Error al procesar el archivo de copia: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// 12. DATOS DE EJEMPLO INICIALES
// ============================================================
async function loadDemoData() {
  const demoItems = [
    {
      id: 'demo-1',
      name: 'Auriculares Inalámbricos Bluetooth ANC TWS',
      category: 'Electrónica',
      status: 'EN_VENTA',
      quantity: 12,
      notes: 'Batería 30h, cancelación activa de ruido, conector USB-C. Proveedor Shenzhen Tech.',
      costRMB: 62.50,
      costEUR: 8.01,
      shippingCost: 1.50,
      customsPercent: 0,
      feePercent: 5.0,
      totalCostEUR: 10.46,
      priceEbay: 21.99,
      priceWallapop: 18.00,
      priceVinted: 16.50,
      marketPrices: [],
      marketAverage: 18.83,
      marketMin: 16.50,
      marketMax: 21.99,
      finalPrice: 18.90,
      netProfit: 8.44,
      marginPercent: 44.7,
      roi: 80.7,
      rateApplied: 7.80,
      photo: {
        type: 'url',
        name: 'auriculares.jpg',
        data: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80'
      },
      createdAt: Date.now() - 3600000 * 24 * 3,
      updatedAt: Date.now()
    },
    {
      id: 'demo-2',
      name: 'Soporte Plegable de Aluminio para Portátil',
      category: 'Informática',
      status: 'COMPRADO',
      quantity: 6,
      notes: 'Aluminio anodizado, 6 posiciones de altura, funda de terciopelo incluida.',
      costRMB: 31.20,
      costEUR: 4.00,
      shippingCost: 1.20,
      customsPercent: 0,
      feePercent: 0,
      totalCostEUR: 5.20,
      priceEbay: 15.99,
      priceWallapop: 12.00,
      priceVinted: 13.50,
      marketPrices: [],
      marketAverage: 13.83,
      marketMin: 12.00,
      marketMax: 15.99,
      finalPrice: 13.99,
      netProfit: 8.79,
      marginPercent: 62.8,
      roi: 169.0,
      rateApplied: 7.80,
      photo: {
        type: 'url',
        name: 'soporte.jpg',
        data: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'
      },
      createdAt: Date.now() - 3600000 * 24 * 2,
      updatedAt: Date.now()
    },
    {
      id: 'demo-3',
      name: 'Mini Báscula Digital de Precisión (0.01g - 500g)',
      category: 'Hogar y Cocina',
      status: 'EN_ESTUDIO',
      quantity: 20,
      notes: 'Pantalla retroiluminada azul, función tara, incluye pilas AAA.',
      costRMB: 15.60,
      costEUR: 2.00,
      shippingCost: 0.80,
      customsPercent: 0,
      feePercent: 0,
      totalCostEUR: 2.80,
      priceEbay: 8.99,
      priceWallapop: 6.50,
      priceVinted: 7.00,
      marketPrices: [],
      marketAverage: 7.50,
      marketMin: 6.50,
      marketMax: 8.99,
      finalPrice: 7.50,
      netProfit: 4.70,
      marginPercent: 62.7,
      roi: 167.9,
      rateApplied: 7.80,
      photo: {
        type: 'url',
        name: 'bascula.jpg',
        data: 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&auto=format&fit=crop&q=80'
      },
      createdAt: Date.now() - 3600000 * 24 * 1,
      updatedAt: Date.now()
    }
  ];

  for (const item of demoItems) {
    await dbSaveArticle(item);
  }

  AppState.articles = demoItems;
  renderArticles();
  showToast('Se han cargado 3 artículos de ejemplo', 'info');
}

// ============================================================
// 13. CONFIGURACIÓN DE EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  // Tema
  document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);

  // Barra de búsqueda y filtros
  const searchInput = document.getElementById('searchInput');
  const btnClear = document.getElementById('btnClearSearch');

  searchInput.addEventListener('input', (e) => {
    AppState.searchTerm = e.target.value;
    btnClear.style.display = AppState.searchTerm ? 'block' : 'none';
    renderArticles();
  });

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    AppState.searchTerm = '';
    btnClear.style.display = 'none';
    renderArticles();
  });

  document.getElementById('filterCategory').addEventListener('change', (e) => {
    AppState.filterCategory = e.target.value;
    renderArticles();
  });

  document.getElementById('filterStatus').addEventListener('change', (e) => {
    AppState.filterStatus = e.target.value;
    renderArticles();
  });

  document.getElementById('sortBy').addEventListener('change', (e) => {
    AppState.sortBy = e.target.value;
    renderArticles();
  });

  // Conmutador de Vistas (Cuadrícula / Tabla)
  const btnGrid = document.getElementById('btnViewGrid');
  const btnTable = document.getElementById('btnViewTable');

  btnGrid.addEventListener('click', () => {
    AppState.currentView = 'grid';
    btnGrid.classList.add('active');
    btnTable.classList.remove('active');
    renderArticles();
  });

  btnTable.addEventListener('click', () => {
    AppState.currentView = 'table';
    btnTable.classList.add('active');
    btnGrid.classList.remove('active');
    renderArticles();
  });

  // Botón Nuevo Artículo
  document.getElementById('btnNewArticle').addEventListener('click', () => openArticleModal());
  const btnMobileAdd = document.getElementById('btnMobileAdd');
  if (btnMobileAdd) btnMobileAdd.addEventListener('click', () => openArticleModal());
  document.getElementById('btnEmptyAdd').addEventListener('click', () => openArticleModal());
  document.getElementById('btnLoadDemo').addEventListener('click', () => loadDemoData());

  // Modal Artículo
  document.getElementById('btnCloseArticleModal').addEventListener('click', closeArticleModal);
  document.getElementById('btnCancelArticleModal').addEventListener('click', closeArticleModal);
  document.getElementById('articleForm').addEventListener('submit', saveArticleHandler);

  // Pestañas de Foto
  const tabUploadFile = document.getElementById('tabUploadFile');
  const tabUploadUrl = document.getElementById('tabUploadUrl');
  const panelUploadFile = document.getElementById('panelUploadFile');
  const panelUploadUrl = document.getElementById('panelUploadUrl');

  tabUploadFile.addEventListener('click', () => {
    tabUploadFile.classList.add('active');
    tabUploadUrl.classList.remove('active');
    panelUploadFile.style.display = 'block';
    panelUploadUrl.style.display = 'none';
  });

  tabUploadUrl.addEventListener('click', () => {
    tabUploadUrl.classList.add('active');
    tabUploadFile.classList.remove('active');
    panelUploadUrl.style.display = 'block';
    panelUploadFile.style.display = 'none';
  });

  // Dropzone de Archivos
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // URL de Foto
  document.getElementById('btnPreviewUrl').addEventListener('click', () => {
    const url = document.getElementById('imageUrlInput').value.trim();
    if (url) {
      AppState.currentPhoto = { type: 'url', data: url, name: 'imagen-enlace.jpg' };
      showPhotoPreview(url, 'Imagen desde URL');
      showToast('Vista previa de URL cargada', 'info');
    }
  });

  document.getElementById('btnRemovePhoto').addEventListener('click', hidePhotoPreview);

  // Conversión de Divisas en Formulario
  const inputRMB = document.getElementById('inputCostRMB');
  const inputEUR = document.getElementById('inputCostEUR');

  inputRMB.addEventListener('input', () => {
    const rmb = parseFloat(inputRMB.value);
    if (!isNaN(rmb) && rmb >= 0) {
      inputEUR.value = (rmb / AppState.exchangeRate).toFixed(2);
    } else {
      inputEUR.value = '';
    }
    recalculateModalForm();
  });

  inputEUR.addEventListener('input', () => {
    const eur = parseFloat(inputEUR.value);
    if (!isNaN(eur) && eur >= 0) {
      inputRMB.value = (eur * AppState.exchangeRate).toFixed(2);
    } else {
      inputRMB.value = '';
    }
    recalculateModalForm();
  });

  // Desplegable de gastos extra
  const toggleExtra = document.getElementById('btnToggleExtraCosts');
  const bodyExtra = document.getElementById('extraCostsBody');
  const toggleIcon = document.getElementById('toggleIcon');

  toggleExtra.addEventListener('click', () => {
    const isOpen = bodyExtra.style.display === 'block';
    bodyExtra.style.display = isOpen ? 'none' : 'block';
    toggleIcon.textContent = isOpen ? '▾' : '▴';
  });

  // Inputs que afectan a cálculos
  ['inputQuantity', 'inputShippingCost', 'inputCustomsPercent', 'inputFeePercent', 'inputFinalPrice',
   'inputPriceEbay', 'inputPriceWallapop', 'inputPriceVinted'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', recalculateModalForm);
  });

  // Toggle de precios adicionales de referencia
  const btnToggleCustom = document.getElementById('btnToggleCustomPrices');
  const customPricesBody = document.getElementById('customPricesBody');
  const toggleCustomIcon = document.getElementById('toggleCustomIcon');
  if (btnToggleCustom && customPricesBody) {
    btnToggleCustom.addEventListener('click', () => {
      const isOpen = customPricesBody.style.display === 'block';
      customPricesBody.style.display = isOpen ? 'none' : 'block';
      if (toggleCustomIcon) toggleCustomIcon.textContent = isOpen ? '▾' : '▴';
    });
  }

  // Añadir precio de referencia
  document.getElementById('btnAddMarketPrice').addEventListener('click', addMarketPriceRow);

  // Aplicar media como precio final
  document.getElementById('btnApplyAverage').addEventListener('click', () => {
    const pEbay = parseFloat(document.getElementById('inputPriceEbay').value) || 0;
    const pWallapop = parseFloat(document.getElementById('inputPriceWallapop').value) || 0;
    const pVinted = parseFloat(document.getElementById('inputPriceVinted').value) || 0;
    const platformPrices = [pEbay, pWallapop, pVinted].filter(p => p > 0);
    const extraPrices = AppState.marketPrices
      .map(p => parseFloat(p.price))
      .filter(p => !isNaN(p) && p > 0);
    const validPrices = [...platformPrices, ...extraPrices];

    if (validPrices.length > 0) {
      const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
      document.getElementById('inputFinalPrice').value = avg.toFixed(2);
      recalculateModalForm();
      showToast(`Media (${avg.toFixed(2)} €) aplicada como precio final`, 'success');
    } else {
      showToast('Añade al menos un precio de referencia válido', 'warning');
    }
  });

  // Exportar a Calc: Menú Desplegable
  const exportDropdown = document.getElementById('exportDropdown').parentElement;
  document.getElementById('btnExportMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!exportDropdown.contains(e.target)) {
      exportDropdown.classList.remove('open');
    }
  });

  document.getElementById('btnExportODS').addEventListener('click', () => exportToCalc('ods'));
  document.getElementById('btnExportXLSX').addEventListener('click', () => exportToCalc('xlsx'));
  document.getElementById('btnExportCSV').addEventListener('click', () => exportToCalc('csv'));

  // Ticker y Modal de Tasa de Cambio
  const rateModal = document.getElementById('rateModal');
  document.getElementById('exchangeTicker').addEventListener('click', () => {
    document.getElementById('inputCustomRate').value = AppState.exchangeRate.toFixed(3);
    document.getElementById('rateLastUpdatedText').textContent = AppState.rateLastUpdated;
    updateRateModalPreviews();
    rateModal.style.display = 'flex';
  });

  document.getElementById('btnRefreshRate').addEventListener('click', (e) => {
    e.stopPropagation();
    fetchLiveExchangeRate();
  });

  document.getElementById('btnCloseRateModal').addEventListener('click', () => rateModal.style.display = 'none');
  document.getElementById('btnFetchRateOnline').addEventListener('click', fetchLiveExchangeRate);

  document.getElementById('inputCustomRate').addEventListener('input', updateRateModalPreviews);

  document.getElementById('btnSaveRate').addEventListener('click', async () => {
    const customRate = parseFloat(document.getElementById('inputCustomRate').value);
    if (!isNaN(customRate) && customRate > 0) {
      AppState.exchangeRate = customRate;
      AppState.rateLastUpdated = 'Manual (' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + ')';
      await dbSetConfig('exchangeRate', customRate);
      await dbSetConfig('rateLastUpdated', AppState.rateLastUpdated);
      updateTickerDisplay();
      recalculateModalForm();
      rateModal.style.display = 'none';
      showToast(`Tasa de cambio guardada: 1 € = ${customRate.toFixed(3)} ¥`, 'success');
    }
  });

  // Calculadora Rápida
  const quickCalcModal = document.getElementById('quickCalcModal');
  document.getElementById('btnOpenQuickCalc').addEventListener('click', () => {
    setupQuickCalc();
    quickCalcModal.style.display = 'flex';
    document.getElementById('quickRmb').focus();
  });
  document.getElementById('btnCloseQuickCalcModal').addEventListener('click', () => quickCalcModal.style.display = 'none');

  // Modal Copia de Seguridad
  const backupModal = document.getElementById('backupModal');
  document.getElementById('btnOpenBackup').addEventListener('click', () => backupModal.style.display = 'flex');
  document.getElementById('btnCloseBackupModal').addEventListener('click', () => backupModal.style.display = 'none');
  document.getElementById('btnDownloadBackup').addEventListener('click', downloadBackup);
  document.getElementById('fileRestoreBackup').addEventListener('change', (e) => handleRestoreBackup(e.target.files[0]));

  document.getElementById('btnClearAllData').addEventListener('click', async () => {
    if (confirm('⚠️ ¿Estás seguro de que deseas eliminar TODOS los artículos del catálogo? Esta acción no se puede deshacer.')) {
      await dbClearAllArticles();
      AppState.articles = [];
      renderArticles();
      backupModal.style.display = 'none';
      showToast('Catálogo vaciado con éxito', 'info');
    }
  });

  // Lightbox
  document.getElementById('btnCloseLightbox').addEventListener('click', () => {
    document.getElementById('lightboxModal').style.display = 'none';
  });

  // Cerrar modales con tecla ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(modal => modal.style.display = 'none');
    }
  });
}

// ============================================================
// 14. UTILIDADES Y NOTIFICACIONES (TOAST)
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 3000);
}

function formatCurrency(amount) {
  return (amount || 0).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.openLightbox = function(src, caption) {
  const modal = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const captionEl = document.getElementById('lightboxCaption');
  img.src = src;
  captionEl.textContent = caption || '';
  modal.style.display = 'flex';
};

// Exportar funciones necesarias a ámbito global para onclicks
window.editArticle = editArticle;
window.duplicateArticle = duplicateArticle;
window.confirmDeleteArticle = confirmDeleteArticle;
