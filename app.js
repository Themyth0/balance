/**
 * ============================================================
 * Balance & Precios - Gestor de Artículos de Importación
 * app.js - Lógica completa de negocio, IndexedDB, Divisas y Calc
 * ============================================================
 */

// Estado global de la aplicación
const AppState = {
  articles: [],
  batches: [],
  activeBatchId: null, // null = Pantalla de Lotes (Home), string ID = Lote activo, 'NONE' = Artículos sin lote
  batchSearchTerm: '',
  batchStatusFilter: 'ALL',
  exchangeRate: 7.80, // 1 EUR = 7.80 RMB por defecto
  rateLastUpdated: 'Predeterminado',
  currentTheme: 'light',
  currentView: 'grid', // 'grid' | 'table'
  searchTerm: '',
  filterCategory: 'ALL',
  filterBatch: 'ALL',
  filterStatus: 'ALL',
  sortBy: 'date_desc',
  editingArticleId: null,
  editingBatchId: null,
  currentPhoto: null, // { type: 'file'|'url', data: string, name: string }
  marketPrices: [], // Array de { id, source, price }
  assignBatchId: null,
  assignSelectedArticleIds: new Set(),
  assignSearchTerm: ''
};

// ============================================================
// 1. BASE DE DATOS LOCAL (IndexedDB)
// ============================================================
const DB_NAME = 'ImportCalcDB';
const DB_VERSION = 2;
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
        articleStore.createIndex('batchId', 'batchId', { unique: false });
        articleStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('batches')) {
        db.createObjectStore('batches', { keyPath: 'id' });
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
    const tx = dbInstance.transaction(['articles', 'batches'], 'readwrite');
    const storeArticles = tx.objectStore('articles');
    const storeBatches = tx.objectStore('batches');
    storeArticles.clear();
    storeBatches.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// Operaciones de Lotes en IndexedDB
function dbGetAllBatches() {
  return new Promise((resolve, reject) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains('batches')) return resolve([]);
    const tx = dbInstance.transaction('batches', 'readonly');
    const store = tx.objectStore('batches');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e);
  });
}

function dbSaveBatch(batch) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('batches', 'readwrite');
    const store = tx.objectStore('batches');
    const request = store.put(batch);
    request.onsuccess = () => resolve(batch);
    request.onerror = (e) => reject(e);
  });
}

function dbDeleteBatch(id) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('batches', 'readwrite');
    const store = tx.objectStore('batches');
    const request = store.delete(id);
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

    // Cargar lotes
    AppState.batches = await dbGetAllBatches();
    populateBatchSelects();

    // Cargar artículos
    const articles = await dbGetAllArticles();
    if (articles.length === 0) {
      // Cargar ejemplos de demostración la primera vez
      await loadDemoData();
    } else {
      AppState.articles = articles;
    }

    setupEventListeners();
    setupQuickCalc();

    // Iniciar siempre en la pantalla principal de Lotes
    navigateToBatches();
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
    btn.innerHTML = theme === 'dark' 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
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
  if (btn) btn.textContent = 'Consultando...';
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
    if (btn) btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Obtener cambio oficial en directo';
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

  // Filtro por lote activo o filtro manual
  if (AppState.activeBatchId === 'NONE') {
    filtered = filtered.filter(a => !a.batchId);
  } else if (AppState.activeBatchId) {
    filtered = filtered.filter(a => a.batchId === AppState.activeBatchId);
  } else if (AppState.filterBatch !== 'ALL') {
    if (AppState.filterBatch === 'NONE') {
      filtered = filtered.filter(a => !a.batchId);
    } else {
      filtered = filtered.filter(a => a.batchId === AppState.filterBatch);
    }
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
      EN_ESTUDIO: '<span class="status-dot dot-study"></span>En estudio',
      COMPRADO: '<span class="status-dot dot-bought"></span>Comprado',
      EN_VENTA: '<span class="status-dot dot-selling"></span>En venta',
      VENDIDO: '<span class="status-dot dot-sold"></span>Vendido',
      DESCARTADO: '<span class="status-dot dot-discarded"></span>Descartado'
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
      : `<div class="card-img-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>`;

    // Margen de beneficio frente al coste
    const unitCost = article.totalCostEUR || article.costEUR || 0;
    const marginCostPercent = unitCost > 0 ? ((article.netProfit || 0) / unitCost) * 100 : 0;
    const isLowMargin = marginCostPercent < 20;

    // Batch badge
    const batchObj = article.batchId ? AppState.batches.find(b => b.id === article.batchId) : null;
    const batchBadgeHtml = batchObj
      ? `<span class="batch-badge" title="Lote: ${escapeHtml(batchObj.name)}">\
<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\
<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>\
<path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> ${escapeHtml(batchObj.name)}</span>`
      : '';

    // Alertas de Stock y Tiempo
    const now = Date.now();
    const createdTimestamp = article.createdAt || now;
    const daysInStock = Math.floor((now - createdTimestamp) / (1000 * 60 * 60 * 24));
    const isStaleStock = article.status === 'EN_VENTA' && daysInStock >= 30;
    const staleBadgeHtml = isStaleStock
      ? `<span class="card-badge-stale" title="Lleva ${daysInStock} días en venta. Considera ajustar el precio o promocionarlo.">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${daysInStock}d en stock
        </span>`
      : '';

    // Semáforo de Margen
    let marginStatusClass = 'margin-optimal';
    let marginWarningBadgeHtml = '';
    if (isLowMargin) {
      marginStatusClass = 'margin-warning';
      marginWarningBadgeHtml = `
        <span class="pill-tag pill-tag-warning" title="Margen bajo (< 20% frente al coste). Revisa tus costes o ajusta el precio final.">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
          Margen Bajo
        </span>`;
    }

    const goofishBadgeHtml = article.goofishUrl
      ? `<a href="${escapeHtml(article.goofishUrl)}" target="_blank" rel="noopener noreferrer" class="goofish-btn-badge" onclick="event.stopPropagation();" title="Abrir en Goofish / Proveedor">🐟 Goofish ↗</a>`
      : '';

    const weightText = (article.weight && article.weight > 0)
      ? ` · ⚖️${article.weight >= 1000 ? (article.weight / 1000).toFixed(1) + 'kg' : article.weight + 'g'}`
      : '';

    return `
      <article class="article-card ${isStaleStock ? 'card-stale-alert' : ''} ${isLowMargin ? 'card-low-margin' : ''}" data-id="${article.id}">
        <div class="card-media">
          ${imageHtml}
          <span class="card-badge-status status-${article.status}">
            ${statusLabels[article.status] || article.status}
          </span>
          <span class="card-badge-qty">${qty} uds${weightText}</span>
          ${article.category ? `<span class="card-badge-category">${escapeHtml(article.category)}</span>` : ''}
          ${staleBadgeHtml}
        </div>

        <div class="card-content">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.35rem;">
            <h3 class="card-title" style="margin: 0;" title="${escapeHtml(article.name)}">${escapeHtml(article.name)}</h3>
            ${goofishBadgeHtml}
          </div>

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
              <span class="profit-lbl">Ganancia Total ${qty > 1 ? `(${article.netProfit >= 0 ? '+' : ''}${article.netProfit.toFixed(2)} €/ud)` : ''}</span>
            </div>
            <div class="profit-badges-group">
              <span class="pill-tag ${isLowMargin ? 'pill-tag-margin-low' : ''}" title="Beneficio neto obtenido frente al coste real unitario">
                Margen: ${marginCostPercent >= 0 ? '+' : ''}${marginCostPercent.toFixed(1)}% frente al coste
              </span>
              ${marginWarningBadgeHtml}
            </div>
          </div>
        </div>

        <div class="card-footer">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <small class="text-muted">Tasa: 1€ = ${article.rateApplied ? article.rateApplied.toFixed(2) : AppState.exchangeRate.toFixed(2)}¥</small>
            ${batchBadgeHtml}
          </div>
          <div class="card-actions-group">
            <button class="btn-card-action" onclick="editArticle('${article.id}')" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              <span>Editar</span>
            </button>
            <button class="btn-card-action" onclick="duplicateArticle('${article.id}')" title="Duplicar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </button>
            <button class="btn-card-action danger" onclick="confirmDeleteArticle('${article.id}')" title="Eliminar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderTableView(articles, tbody) {
  const statusLabels = {
    EN_ESTUDIO: '<span class="status-dot dot-study"></span>En estudio',
    COMPRADO: '<span class="status-dot dot-bought"></span>Comprado',
    EN_VENTA: '<span class="status-dot dot-selling"></span>En venta',
    VENDIDO: '<span class="status-dot dot-sold"></span>Vendido',
    DESCARTADO: '<span class="status-dot dot-discarded"></span>Descartado'
  };


  tbody.innerHTML = articles.map(article => {
    const photoSrc = article.photo ? article.photo.data : '';
    const imgHtml = photoSrc
      ? `<img src="${photoSrc}" class="table-thumb" alt="Foto" onclick="openLightbox('${photoSrc}', '${escapeHtml(article.name)}')">`
      : `<div class="table-thumb-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>`;

    const qty = article.quantity || 1;
    const batchCost = (article.totalCostEUR || 0) * qty;
    const batchRevenue = (article.finalPrice || 0) * qty;
    const batchProfit = (article.netProfit || 0) * qty;

    const profitColor = batchProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    const isTableStale = article.status === 'EN_VENTA' && (Date.now() - (article.createdAt || Date.now())) >= (30 * 24 * 60 * 60 * 1000);
    const tableDaysInStock = Math.floor((Date.now() - (article.createdAt || Date.now())) / (1000 * 60 * 60 * 24));
    const tableUnitCost = article.totalCostEUR || article.costEUR || 0;
    const tableMarginCost = tableUnitCost > 0 ? ((article.netProfit || 0) / tableUnitCost) * 100 : 0;

    return `
      <tr class="${isTableStale ? 'row-stale-alert' : ''} ${tableMarginCost < 20 ? 'row-low-margin' : ''}">
        <td>${imgHtml}</td>
        <td>
          <div class="table-item-name">
            ${escapeHtml(article.name)}
            ${isTableStale ? `<span class="table-stale-tag" title="Lleva ${tableDaysInStock} días en venta">${tableDaysInStock}d stock</span>` : ''}
            ${article.goofishUrl ? `<a href="${escapeHtml(article.goofishUrl)}" target="_blank" rel="noopener noreferrer" class="table-goofish-link" title="Abrir en Goofish">🐟 Goofish ↗</a>` : ''}
          </div>
          ${article.notes ? `<small class="text-muted">${escapeHtml(article.notes.substring(0, 45))}${article.notes.length > 45 ? '...' : ''}</small>` : ''}
        </td>
        <td><span class="pill-tag">${escapeHtml(article.category || 'General')}</span></td>
        <td class="col-batch">${tableBatchObj ? `<span class="batch-badge">${escapeHtml(tableBatchObj.name)}</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td><span class="card-badge-status status-${article.status}">${statusLabels[article.status] || article.status}</span></td>
        <td><span class="pill-tag" style="font-weight: 700; font-size: 0.82rem;">${qty} uds</span></td>
        <td class="col-weight" style="font-size: 0.80rem; color: var(--text-secondary);">${article.weight > 0 ? (article.weight >= 1000 ? (article.weight / 1000).toFixed(2) + ' kg' : article.weight + ' g') : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td>${article.totalCostEUR.toFixed(2)} €</td>
        <td><strong style="color: var(--warning-text);">${batchCost.toFixed(2)} €</strong></td>
        <td class="col-platform-ebay">${article.priceEbay > 0 ? `<span class="platform-chip ebay">eBay ${article.priceEbay.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="col-platform-wallapop">${article.priceWallapop > 0 ? `<span class="platform-chip wallapop">Wallp. ${article.priceWallapop.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="col-platform-vinted">${article.priceVinted > 0 ? `<span class="platform-chip vinted">Vinted ${article.priceVinted.toFixed(2)}€</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td>${article.marketAverage > 0 ? article.marketAverage.toFixed(2) + ' €' : '—'}</td>
        <td style="font-weight: 700; color: var(--brand);">${article.finalPrice.toFixed(2)} €</td>
        <td><strong>${batchRevenue.toFixed(2)} €</strong></td>
        <td style="font-weight: 700; color: ${profitColor};">
          ${batchProfit >= 0 ? '+' : ''}${batchProfit.toFixed(2)} €
          <br><small class="text-muted">(${article.netProfit >= 0 ? '+' : ''}${article.netProfit.toFixed(2)} €/ud)</small>
        </td>
        <td>
          <span class="pill-tag ${tableMarginCost < 20 ? 'pill-tag-margin-low' : ''}" style="font-weight: 700;" title="Margen de beneficio frente al coste: ${tableMarginCost >= 0 ? '+' : ''}${tableMarginCost.toFixed(1)}%">${tableMarginCost >= 0 ? '+' : ''}${tableMarginCost.toFixed(1)}%</span>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-card-action" onclick="editArticle('${article.id}')" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn-card-action danger" onclick="confirmDeleteArticle('${article.id}')" title="Eliminar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateGlobalKPIs() {
  let articles = AppState.articles;
  if (AppState.activeBatchId === 'NONE') {
    articles = articles.filter(a => !a.batchId);
  } else if (AppState.activeBatchId) {
    articles = articles.filter(a => a.batchId === AppState.activeBatchId);
  }

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

  const kpiTotal = document.getElementById('kpiTotalArticles');
  if (kpiTotal) kpiTotal.textContent = `${count} artículos (${totalUnits} uds)`;

  const kpiCost = document.getElementById('kpiTotalCost');
  if (kpiCost) kpiCost.textContent = formatCurrency(totalCostEUR);

  const kpiRMB = document.getElementById('kpiTotalCostRMB');
  if (kpiRMB) kpiRMB.textContent = `¥ ${totalCostRMB.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RMB`;

  const kpiRev = document.getElementById('kpiTotalRevenue');
  if (kpiRev) kpiRev.textContent = formatCurrency(totalRevenue);

  const kpiAvg = document.getElementById('kpiAveragePrice');
  if (kpiAvg) kpiAvg.textContent = `Media: ${formatCurrency(avgPrice)}/ud`;
  
  const profitEl = document.getElementById('kpiTotalProfit');
  if (profitEl) {
    profitEl.textContent = (totalProfit >= 0 ? '+' : '') + formatCurrency(totalProfit);
    profitEl.className = totalProfit >= 0 ? 'kpi-value green-text' : 'kpi-value text-danger';
  }

  const kpiMargin = document.getElementById('kpiAverageMargin');
  if (kpiMargin) kpiMargin.textContent = `Margen medio: ${avgMargin.toFixed(1)}%`;
}

function updateCategoryDropdown() {
  const select = document.getElementById('filterCategory');
  if (!select) return;
  const datalist = document.getElementById('categoriesList');
  const currentVal = select.value;

  const categories = new Set();
  const pool = AppState.activeBatchId
    ? (AppState.activeBatchId === 'NONE' ? AppState.articles.filter(a => !a.batchId) : AppState.articles.filter(a => a.batchId === AppState.activeBatchId))
    : AppState.articles;

  pool.forEach(a => {
    if (a.category && a.category.trim()) categories.add(a.category.trim());
  });

  // Reconstruir select
  let html = '<option value="ALL">Todas las categorías</option>';
  categories.forEach(cat => {
    html += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
  });
  select.innerHTML = html;
  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = 'ALL';
    AppState.filterCategory = 'ALL';
  }

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

    // Lote asignado
    document.getElementById('inputBatchId').value = article.batchId || '';
    updateBatchShippingNote(article.batchId || '');

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

    // Lote: si estamos dentro de un lote activo, asignarlo por defecto
    const defaultBatch = (AppState.activeBatchId && AppState.activeBatchId !== 'NONE') ? AppState.activeBatchId : '';
    document.getElementById('inputBatchId').value = defaultBatch;
    updateBatchShippingNote(defaultBatch);

    // Limpiar campos de plataformas
    document.getElementById('inputPriceEbay').value = '';
    document.getElementById('inputPriceWallapop').value = '';
    document.getElementById('inputPriceVinted').value = '';

    // Sin filas de mercado adicionales
    AppState.marketPrices = [];
  }

  // Cargar Goofish URL y Peso
  const goofishInput = document.getElementById('inputGoofishUrl');
  const weightInput = document.getElementById('inputWeight');
  const linkTestGoofish = document.getElementById('linkTestGoofish');
  if (goofishInput) goofishInput.value = article ? (article.goofishUrl || '') : '';
  if (weightInput) weightInput.value = (article && article.weight) ? article.weight : '';
  if (linkTestGoofish) {
    if (article && article.goofishUrl) {
      linkTestGoofish.href = article.goofishUrl;
      linkTestGoofish.style.display = 'inline';
    } else {
      linkTestGoofish.style.display = 'none';
    }
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
  const marginCostPercent = totalCostEUR > 0 ? (netProfit / totalCostEUR) * 100 : 0;
  const roi = marginCostPercent;

  const profitBadge = document.getElementById('profitBadge');
  const batchProfitBadge = document.getElementById('batchProfitBadge');
  const netProfitEl = document.getElementById('displayNetProfit');
  const batchProfitEl = document.getElementById('displayBatchProfit');
  const marginEl = document.getElementById('displayMarginPercent');
  const roiEl = document.getElementById('displayROI');

  netProfitEl.textContent = (netProfit >= 0 ? '+' : '') + netProfit.toFixed(2) + ' €';
  batchProfitEl.textContent = (batchProfit >= 0 ? '+' : '') + batchProfit.toFixed(2) + ' €';
  marginEl.textContent = (marginCostPercent >= 0 ? '+' : '') + marginCostPercent.toFixed(1) + '%';
  if (roiEl) roiEl.textContent = roi.toFixed(1) + '%';

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
    summaryEl.innerHTML = `<strong>Resumen del Lote (${quantity} uds):</strong> Inversión: <strong>${batchCost.toFixed(2)} €</strong> | Facturación: <strong>${batchRevenue.toFixed(2)} €</strong> | Ganancia limpia: <strong style="color: ${profitColor};">${batchProfit >= 0 ? '+' : ''}${batchProfit.toFixed(2)} €</strong>`;
    summaryEl.style.display = 'block';
  } else {
    summaryEl.style.display = 'none';
  }

  // Comparativa vs Media
  const noteEl = document.getElementById('vsMarketNote');
  if (noteEl) {
    if (finalPrice > 0 && marketAvg > 0) {
      const diff = finalPrice - marketAvg;
      if (Math.abs(diff) < 0.05) {
        noteEl.innerHTML = '<span class="status-dot dot-bought"></span> Tu precio es exactamente igual a la media de mercado.';
        noteEl.style.color = 'var(--brand)';
      } else if (diff < 0) {
        noteEl.innerHTML = `<span class="status-dot dot-selling"></span> <strong>Precio competitivo</strong>: estás ${Math.abs(diff).toFixed(2)} € por debajo de la media (${marketAvg.toFixed(2)} €).`;
        noteEl.style.color = 'var(--emerald-text)';
      } else {
        noteEl.innerHTML = `<span class="status-dot dot-study"></span> Estás ${diff.toFixed(2)} € por encima de la media de mercado (${marketAvg.toFixed(2)} €).`;
        noteEl.style.color = 'var(--amber-text)';
      }
    } else {
      noteEl.textContent = 'Introduce el precio final para comparar con la media de mercado.';
      noteEl.style.color = 'var(--text-muted)';
    }
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
      <button type="button" class="btn-remove-row" onclick="removeMarketPriceRow('${item.id}')" title="Quitar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
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

  const goofishUrl = (document.getElementById('inputGoofishUrl')?.value || '').trim();
  const weight = Math.max(0, parseFloat(document.getElementById('inputWeight')?.value) || 0);

  // Lote asignado
  const selectedBatchId = document.getElementById('inputBatchId').value || null;
  // Guardar batchId previo para recalcular el lote antiguo si cambió
  const prevArticle = AppState.editingArticleId ? AppState.articles.find(a => a.id === AppState.editingArticleId) : null;
  const prevBatchId = prevArticle ? (prevArticle.batchId || null) : null;

  const articleData = {
    id: AppState.editingArticleId || Date.now().toString(),
    name,
    category: document.getElementById('inputCategory').value.trim() || 'General',
    status: document.getElementById('inputStatus').value,
    quantity,
    notes: document.getElementById('inputNotes').value.trim(),
    goofishUrl,
    weight,
    batchId: selectedBatchId,
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

    // Recalcular lote nuevo
    if (selectedBatchId) {
      await recalculateBatchArticles(selectedBatchId);
    }
    // Si cambió de lote, recalcular el lote anterior también
    if (prevBatchId && prevBatchId !== selectedBatchId) {
      await recalculateBatchArticles(prevBatchId);
    }

    closeArticleModal();
    renderArticles();
    updateMainBatchesKPIs();
    renderMainBatches();
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
    if (duplicated.batchId) {
      await recalculateBatchArticles(duplicated.batchId);
    }
    renderArticles();
    updateMainBatchesKPIs();
    renderMainBatches();
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
      if (article && article.batchId) {
        await recalculateBatchArticles(article.batchId);
      }
      renderArticles();
      updateMainBatchesKPIs();
      renderMainBatches();
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
      const batchObj = a.batchId ? AppState.batches.find(b => b.id === a.batchId) : null;

      return {
        'Nº': index + 1,
        'Artículo': a.name,
        'Categoría': a.category || 'General',
        'Lote / Envío': batchObj ? batchObj.name : 'Sin lote',
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
      { wch: 22 }, // Lote / Envío
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
  // Lotes de demostración
  const demoBatch1 = {
    id: 'demo-batch-1',
    name: 'Lote Septiembre #1 — Auriculares & Soportes',
    totalShippingCost: 32.00,
    totalWeight: 5.2,
    distributionMethod: 'PER_UNIT',
    status: 'RECIBIDO',
    tracking: 'ES9999999999CN',
    notes: 'Caja 5.2kg vía agente de carga. Entregada el 03/09.',
    createdAt: Date.now() - 3600000 * 24 * 5,
    updatedAt: Date.now()
  };

  const demoBatch2 = {
    id: 'demo-batch-2',
    name: 'Lote Septiembre #2 — Hubs & Conectividad',
    totalShippingCost: 18.50,
    totalWeight: 2.8,
    distributionMethod: 'PER_UNIT',
    status: 'EN_CAMINO',
    tracking: 'YT249018239CN',
    notes: 'Paquete de 2.8kg vía YunExpress en tránsito aéreo.',
    createdAt: Date.now() - 3600000 * 24 * 2,
    updatedAt: Date.now()
  };

  const demoItems = [
    {
      id: 'demo-1',
      name: 'Auriculares Inalámbricos Bluetooth ANC TWS',
      category: 'Electrónica',
      status: 'EN_VENTA',
      quantity: 12,
      weight: 220,
      goofishUrl: 'https://m.goofish.com/item?id=7821948218',
      batchId: 'demo-batch-1',
      notes: 'Batería 30h, cancelación activa de ruido, conector USB-C. Proveedor Shenzhen Tech.',
      costRMB: 62.50,
      costEUR: 8.01,
      shippingCost: 1.78, // prorrateado del lote: 32€ / 18 uds totales (12+6)
      customsPercent: 0,
      feePercent: 5.0,
      totalCostEUR: 10.74,
      priceEbay: 21.99,
      priceWallapop: 18.00,
      priceVinted: 16.50,
      marketPrices: [],
      marketAverage: 18.83,
      marketMin: 16.50,
      marketMax: 21.99,
      finalPrice: 18.90,
      netProfit: 8.16,
      marginPercent: 43.2,
      roi: 76.0,
      rateApplied: 7.80,
      photo: {
        type: 'url',
        name: 'auriculares.jpg',
        data: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80'
      },
      createdAt: Date.now() - 3600000 * 24 * 38, // 38 días en venta (alerta de stock estancado)
      updatedAt: Date.now()
    },
    {
      id: 'demo-2',
      name: 'Soporte Plegable de Aluminio para Portátil',
      category: 'Informática',
      status: 'COMPRADO',
      quantity: 6,
      weight: 380,
      goofishUrl: 'https://m.goofish.com/item?id=8192039102',
      batchId: 'demo-batch-1',
      notes: 'Aluminio anodizado, 6 posiciones de altura, funda de terciopelo incluida.',
      costRMB: 31.20,
      costEUR: 4.00,
      shippingCost: 1.78, // prorrateado del lote
      customsPercent: 0,
      feePercent: 0,
      totalCostEUR: 5.78,
      priceEbay: 15.99,
      priceWallapop: 12.00,
      priceVinted: 13.50,
      marketPrices: [],
      marketAverage: 13.83,
      marketMin: 12.00,
      marketMax: 15.99,
      finalPrice: 13.99,
      netProfit: 8.21,
      marginPercent: 58.7,
      roi: 142.0,
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
      weight: 140,
      goofishUrl: '',
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
    },
    {
      id: 'demo-4',
      name: 'Hub Adaptador USB-C 7 en 1 HDMI 4K',
      category: 'Informática',
      status: 'EN_VENTA',
      quantity: 5,
      weight: 95,
      goofishUrl: 'https://m.goofish.com/item?id=7501928419',
      batchId: 'demo-batch-2',
      notes: 'Salida HDMI 4K, 3 puertos USB 3.0, lector SD/TF y PD 100W.',
      costRMB: 140.40,
      costEUR: 18.00,
      shippingCost: 3.70,
      customsPercent: 0,
      feePercent: 8.0, // Comisión venta
      totalCostEUR: 23.82,
      priceEbay: 28.90,
      priceWallapop: 26.00,
      priceVinted: 25.00,
      marketPrices: [],
      marketAverage: 26.63,
      marketMin: 25.00,
      marketMax: 28.90,
      finalPrice: 26.50,
      netProfit: 2.68,
      marginPercent: 10.1, // Margen bajo (< 20%) -> activa semáforo ámbar
      roi: 11.3,
      rateApplied: 7.80,
      photo: {
        type: 'url',
        name: 'hub.jpg',
        data: 'https://images.unsplash.com/photo-1544652478-6653e09f18a2?w=600&auto=format&fit=crop&q=80'
      },
      createdAt: Date.now() - 3600000 * 24 * 8,
      updatedAt: Date.now()
    }
  ];

  await dbSaveBatch(demoBatch1);
  await dbSaveBatch(demoBatch2);
  AppState.batches = [demoBatch1, demoBatch2];
  populateBatchSelects();

  for (const item of demoItems) {
    await dbSaveArticle(item);
  }

  AppState.articles = demoItems;
  await recalculateBatchArticles('demo-batch-1');
  await recalculateBatchArticles('demo-batch-2');

  updateMainBatchesKPIs();
  renderMainBatches();
  showToast('Se han cargado 4 artículos y 2 lotes de ejemplo', 'info');
}




// ============================================================
// 12b. LÓGICA DE LOTES Y ENVÍOS CONSOLIDADOS
// ============================================================

/**
 * Puebla los selects #inputBatchId (modal de artículo) y #filterBatch (barra de filtros)
 * con los lotes disponibles en AppState.batches.
 */
function populateBatchSelects() {
  const inputBatchId = document.getElementById('inputBatchId');
  const filterBatch = document.getElementById('filterBatch');

  // Build options HTML for batch selects
  const batchOptionsHtml = AppState.batches.map(b =>
    `<option value="${b.id}">${escapeHtml(b.name)}</option>`
  ).join('');

  if (inputBatchId) {
    const currentVal = inputBatchId.value;
    inputBatchId.innerHTML = `<option value="">Sin lote (Envío individual)</option>${batchOptionsHtml}`;
    inputBatchId.value = currentVal;
  }

  if (filterBatch) {
    const currentFilter = filterBatch.value;
    filterBatch.innerHTML = `<option value="ALL">Todos los lotes</option><option value="NONE">Sin lote asignado</option>${batchOptionsHtml}`;
    filterBatch.value = currentFilter || 'ALL';
  }
}

/**
 * Muestra u oculta la nota de envío prorrateado del lote en el modal de artículo.
 */
function updateBatchShippingNote(batchId) {
  const noteEl = document.getElementById('batchShippingNote');
  const noteText = document.getElementById('batchShippingNoteText');
  if (!noteEl) return;

  if (batchId) {
    const batch = AppState.batches.find(b => b.id === batchId);
    if (batch) {
      const batchArticles = AppState.articles.filter(a => a.batchId === batchId);
      const totalUnits = batchArticles.reduce((sum, a) => sum + (a.quantity || 1), 0);
      const unitShipping = totalUnits > 0 ? batch.totalShippingCost / totalUnits : batch.totalShippingCost;
      if (noteText) noteText.textContent = `Envío prorrateado del Lote "${batch.name}": ${unitShipping.toFixed(2)} €/ud (${batch.totalShippingCost.toFixed(2)} € ÷ ${totalUnits} uds)`;
      noteEl.style.display = 'flex';
      // Pre-fill shipping cost field
      const shippingInput = document.getElementById('inputShippingCost');
      if (shippingInput) {
        shippingInput.value = unitShipping.toFixed(2);
        recalculateModalForm();
      }
    }
  } else {
    noteEl.style.display = 'none';
  }
}

/**
 * Recalcula el coste de envío unitario de todos los artículos de un lote
 * distribuyendo batch.totalShippingCost entre la suma de unidades del lote,
 * proporcionalmente al coste o proporcionalmente al peso de cada artículo.
 */
async function recalculateBatchArticles(batchId) {
  if (!batchId) return;

  const batch = AppState.batches.find(b => b.id === batchId);
  if (!batch) return;

  const batchArticles = AppState.articles.filter(a => a.batchId === batchId);
  if (batchArticles.length === 0) return;

  const totalUnits = batchArticles.reduce((sum, a) => sum + (a.quantity || 1), 0);
  const totalCostForProportion = batchArticles.reduce((sum, a) => sum + (a.costEUR || 0) * (a.quantity || 1), 0);
  const totalWeightG = batchArticles.reduce((sum, a) => sum + ((a.weight || 0) * (a.quantity || 1)), 0);

  for (const article of batchArticles) {
    let unitShipping;
    const qty = article.quantity || 1;

    if (batch.distributionMethod === 'BY_WEIGHT' && totalWeightG > 0) {
      const articleTotalWeight = (article.weight || 0) * qty;
      const proportion = articleTotalWeight / totalWeightG;
      unitShipping = (batch.totalShippingCost * proportion) / qty;
    } else if (batch.distributionMethod === 'PROPORTIONAL_COST' && totalCostForProportion > 0) {
      const proportion = ((article.costEUR || 0) * qty) / totalCostForProportion;
      const articleShippingTotal = batch.totalShippingCost * proportion;
      unitShipping = articleShippingTotal / qty;
    } else {
      // PER_UNIT (default)
      unitShipping = batch.totalShippingCost / (totalUnits || 1);
    }

    const customsAmount = (article.costEUR || 0) * ((article.customsPercent || 0) / 100);
    const feeAmount = (article.finalPrice || 0) * ((article.feePercent || 0) / 100);
    const totalCostEUR = (article.costEUR || 0) + unitShipping + customsAmount + feeAmount;

    const netProfit = (article.finalPrice || 0) - totalCostEUR;
    const marginPercent = article.finalPrice > 0 ? (netProfit / article.finalPrice) * 100 : 0;
    const roi = totalCostEUR > 0 ? (netProfit / totalCostEUR) * 100 : 0;

    const updated = {
      ...article,
      shippingCost: unitShipping,
      totalCostEUR,
      totalBatchCostEUR: totalCostEUR * qty,
      totalBatchProfit: netProfit * qty,
      totalBatchRevenue: (article.finalPrice || 0) * qty,
      netProfit,
      marginPercent,
      roi,
      updatedAt: Date.now()
    };

    await dbSaveArticle(updated);
    const idx = AppState.articles.findIndex(a => a.id === article.id);
    if (idx >= 0) AppState.articles[idx] = updated;
  }
}

/**
 * Renderiza la lista de lotes en el modal #batchesModal.
 */
function renderBatchesList() {
  const container = document.getElementById('batchesListContainer');
  if (!container) return;

  if (AppState.batches.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 0.75rem; display: block;">
          <path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
          <path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
        </svg>
        <p style="margin: 0; font-size: 0.92rem;">Aún no has creado ningún lote. Usa el botón <strong>Nuevo Lote</strong> para empezar.</p>
      </div>
    `;
    return;
  }

  const statusBadge = {
    EN_PREPARACION: '<span class="batch-status-badge badge-prep">En preparación</span>',
    EN_CAMINO: '<span class="batch-status-badge badge-transit">En camino</span>',
    RECIBIDO: '<span class="batch-status-badge badge-received">Recibido</span>'
  };

  container.innerHTML = AppState.batches.map(batch => {
    const articles = AppState.articles.filter(a => a.batchId === batch.id);
    const totalUnits = articles.reduce((s, a) => s + (a.quantity || 1), 0);
    const totalCost = articles.reduce((s, a) => s + (a.totalCostEUR || 0) * (a.quantity || 1), 0);
    const totalProfit = articles.reduce((s, a) => s + (a.netProfit || 0) * (a.quantity || 1), 0);
    const totalWeightKg = articles.reduce((s, a) => s + ((a.weight || 0) * (a.quantity || 1)), 0) / 1000;
    const profitColor = totalProfit >= 0 ? 'var(--success-text)' : 'var(--danger-text)';

    return `
      <div class="batch-card">
        <div class="batch-card-header">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.3rem;">
              ${statusBadge[batch.status] || ''}
              <strong style="font-size: 0.97rem;">${escapeHtml(batch.name)}</strong>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted);">
              ${articles.length} artículos · ${totalUnits} unidades totales
              ${batch.tracking ? ` · <span style="font-family: monospace;">${escapeHtml(batch.tracking)}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 0.4rem; flex-shrink: 0; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="openBatchAssignModal('${batch.id}')" title="Seleccionar con el ratón qué productos van en este paquete">
              📦 Asignar Artículos
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openBatchEditModal('${batch.id}')" title="Editar lote">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              Editar
            </button>
            <button class="btn btn-danger-outline btn-sm" onclick="deleteBatch('${batch.id}')" title="Eliminar lote">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="batch-metrics-grid">
          <div class="batch-metric-item">
            <span class="batch-metric-lbl">Envío total</span>
            <strong class="batch-metric-val">${(batch.totalShippingCost || 0).toFixed(2)} €</strong>
          </div>
          <div class="batch-metric-item">
            <span class="batch-metric-lbl">Peso artículos</span>
            <strong class="batch-metric-val">⚖️ ${totalWeightKg > 0 ? totalWeightKg.toFixed(2) + ' kg' : '0.00 kg'}${batch.totalWeight ? ` <small class="text-muted">(${batch.totalWeight.toFixed(2)}kg)</small>` : ''}</strong>
          </div>
          <div class="batch-metric-item">
            <span class="batch-metric-lbl">Inversión total</span>
            <strong class="batch-metric-val" style="color: var(--warning-text);">${totalCost.toFixed(2)} €</strong>
          </div>
          <div class="batch-metric-item">
            <span class="batch-metric-lbl">Beneficio estimado</span>
            <strong class="batch-metric-val" style="color: ${profitColor};">${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} €</strong>
          </div>
        </div>
        ${batch.notes ? `<p style="margin: 0.6rem 0 0; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(batch.notes)}</p>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Abre el modal de crear/editar lote.
 */
function openBatchEditModal(batchId = null) {
  AppState.editingBatchId = batchId;
  const modal = document.getElementById('batchEditModal');
  const titleEl = document.getElementById('batchEditModalTitle');
  const form = document.getElementById('batchForm');
  form.reset();

  const articlesCountText = document.getElementById('batchEditArticlesCountText');

  if (batchId) {
    const batch = AppState.batches.find(b => b.id === batchId);
    if (batch) {
      titleEl.textContent = 'Editar Lote';
      document.getElementById('batchEditId').value = batch.id;
      document.getElementById('batchInputName').value = batch.name;
      document.getElementById('batchInputShippingCost').value = batch.totalShippingCost || 0;
      document.getElementById('batchInputWeight').value = batch.totalWeight || '';
      document.getElementById('batchInputStatus').value = batch.status || 'EN_CAMINO';
      document.getElementById('batchInputDistribution').value = batch.distributionMethod || 'PER_UNIT';
      document.getElementById('batchInputTracking').value = batch.tracking || '';
      document.getElementById('batchInputNotes').value = batch.notes || '';

      const bArticles = AppState.articles.filter(a => a.batchId === batchId);
      const bUnits = bArticles.reduce((s, a) => s + (a.quantity || 1), 0);
      const bWeightKg = bArticles.reduce((s, a) => s + ((a.weight || 0) * (a.quantity || 1)), 0) / 1000;
      if (articlesCountText) {
        articlesCountText.textContent = `${bArticles.length} artículos · ${bUnits} uds · ⚖️ ${bWeightKg.toFixed(2)} kg calculados`;
      }
    }
  } else {
    titleEl.textContent = 'Nuevo Lote de Envío';
    document.getElementById('batchEditId').value = '';
    document.getElementById('batchInputWeight').value = '';
    if (articlesCountText) {
      articlesCountText.textContent = 'Guarda el lote para empezar a asignarle productos con el ratón';
    }
  }

  modal.style.display = 'flex';
  document.getElementById('batchInputName').focus();
}

/**
 * Guarda el lote (crear o editar) y recalcula artículos.
 */
async function saveBatchHandler(e) {
  e.preventDefault();

  const name = document.getElementById('batchInputName').value.trim();
  if (!name) {
    showToast('El nombre del lote es obligatorio.', 'error');
    return;
  }

  const totalShippingCost = parseFloat(document.getElementById('batchInputShippingCost').value) || 0;
  const totalWeight = parseFloat(document.getElementById('batchInputWeight').value) || 0;

  const batchData = {
    id: AppState.editingBatchId || Date.now().toString(),
    name,
    totalShippingCost,
    totalWeight,
    distributionMethod: document.getElementById('batchInputDistribution').value,
    status: document.getElementById('batchInputStatus').value,
    tracking: document.getElementById('batchInputTracking').value.trim(),
    notes: document.getElementById('batchInputNotes').value.trim(),
    createdAt: AppState.editingBatchId
      ? (AppState.batches.find(b => b.id === AppState.editingBatchId)?.createdAt || Date.now())
      : Date.now(),
    updatedAt: Date.now()
  };

  try {
    await dbSaveBatch(batchData);

    const existingIdx = AppState.batches.findIndex(b => b.id === batchData.id);
    if (existingIdx >= 0) {
      AppState.batches[existingIdx] = batchData;
    } else {
      AppState.batches.push(batchData);
    }

    populateBatchSelects();
    await recalculateBatchArticles(batchData.id);
    renderArticles();
    renderBatchesList();
    updateMainBatchesKPIs();
    renderMainBatches();

    document.getElementById('batchEditModal').style.display = 'none';
    AppState.editingBatchId = null;

    showToast(`Lote "${name}" guardado correctamente`, 'success');
  } catch (error) {
    console.error('Error al guardar lote:', error);
    showToast('Error al guardar el lote', 'error');
  }
}

/**
 * Abre el modal de asignación visual de artículos para un lote dado.
 */
function openBatchAssignModal(batchId) {
  const batch = AppState.batches.find(b => b.id === batchId);
  if (!batch) {
    showToast('Lote no encontrado.', 'error');
    return;
  }

  AppState.assignBatchId = batchId;
  AppState.assignSelectedArticleIds = new Set(
    AppState.articles.filter(a => a.batchId === batchId).map(a => a.id)
  );
  AppState.assignSearchTerm = '';

  const modal = document.getElementById('batchAssignModal');
  const title = document.getElementById('batchAssignModalTitle');
  const subtitle = document.getElementById('batchAssignModalSubtitle');
  const searchInput = document.getElementById('batchAssignSearch');

  if (title) title.textContent = `Asignar Artículos — ${batch.name}`;
  if (subtitle) subtitle.textContent = `Haz clic en los productos para agregarlos o quitarlos de este paquete (${(batch.totalShippingCost || 0).toFixed(2)} € de envío)`;
  if (searchInput) searchInput.value = '';

  renderBatchAssignItems();
  modal.style.display = 'flex';
}

/**
 * Conmuta la selección de un artículo en el modal de asignación.
 */
function toggleAssignArticle(articleId) {
  if (AppState.assignSelectedArticleIds.has(articleId)) {
    AppState.assignSelectedArticleIds.delete(articleId);
  } else {
    AppState.assignSelectedArticleIds.add(articleId);
  }
  renderBatchAssignItems();
}

/**
 * Renderiza la cuadrícula de artículos seleccionables en #batchAssignItemsList.
 */
function renderBatchAssignItems() {
  const container = document.getElementById('batchAssignItemsList');
  if (!container) return;

  const batch = AppState.batches.find(b => b.id === AppState.assignBatchId);
  const search = (AppState.assignSearchTerm || '').toLowerCase().trim();

  const filtered = AppState.articles.filter(a => {
    if (!search) return true;
    const name = (a.name || '').toLowerCase();
    const cat = (a.category || '').toLowerCase();
    return name.includes(search) || cat.includes(search);
  });

  // Estadísticas globales de selección actual
  const selectedArticles = AppState.articles.filter(a => AppState.assignSelectedArticleIds.has(a.id));
  const selectedUnits = selectedArticles.reduce((s, a) => s + (a.quantity || 1), 0);
  const selectedWeightG = selectedArticles.reduce((s, a) => s + ((a.weight || 0) * (a.quantity || 1)), 0);
  const selectedWeightKg = selectedWeightG / 1000;

  const countEl = document.getElementById('assignSelectedCount');
  const unitsEl = document.getElementById('assignSelectedUnits');
  const weightEl = document.getElementById('assignSelectedWeight');
  const saveBtnCount = document.getElementById('btnSaveAssignCount');
  const prorateEl = document.getElementById('assignBatchShippingProrate');

  if (countEl) countEl.textContent = selectedArticles.length;
  if (unitsEl) unitsEl.textContent = selectedUnits;
  if (weightEl) weightEl.textContent = selectedWeightKg.toFixed(2);
  if (saveBtnCount) saveBtnCount.textContent = selectedArticles.length;

  if (prorateEl && batch) {
    if (selectedUnits > 0) {
      const unitProrate = (batch.totalShippingCost || 0) / selectedUnits;
      prorateEl.textContent = `Prorrateo estimado: ~${unitProrate.toFixed(2)} €/ud de envío`;
    } else {
      prorateEl.textContent = 'Haz clic en los productos para asignarlos al lote';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
        No se encontraron artículos que coincidan con la búsqueda.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(article => {
    const isSelected = AppState.assignSelectedArticleIds.has(article.id);
    const photoSrc = article.photo ? article.photo.data : '';
    const imgHtml = photoSrc
      ? `<img src="${photoSrc}" class="assign-item-thumb" alt="${escapeHtml(article.name)}">`
      : `<div class="assign-item-thumb placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.8"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>`;

    // Etiqueta de lote actual
    let batchTagHtml = '';
    if (article.batchId === AppState.assignBatchId) {
      batchTagHtml = '<span class="assign-batch-tag in-this-batch">En este lote</span>';
    } else if (article.batchId) {
      const otherBatch = AppState.batches.find(b => b.id === article.batchId);
      batchTagHtml = `<span class="assign-batch-tag in-other-batch">En: ${escapeHtml(otherBatch ? otherBatch.name : 'Otro lote')}</span>`;
    } else {
      batchTagHtml = '<span class="assign-batch-tag no-batch">Sin lote</span>';
    }

    const weightText = article.weight > 0
      ? (article.weight >= 1000 ? `${(article.weight / 1000).toFixed(2)} kg` : `${article.weight} g`)
      : 'Sin peso';

    return `
      <div class="assign-item-card ${isSelected ? 'selected' : ''}" onclick="toggleAssignArticle('${article.id}')">
        <div class="assign-checkbox-wrap">
          <input type="checkbox" class="assign-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleAssignArticle('${article.id}')">
        </div>
        ${imgHtml}
        <div class="assign-item-info">
          <div class="assign-item-title" title="${escapeHtml(article.name)}">${escapeHtml(article.name)}</div>
          <div class="assign-item-meta">
            <span class="pill-tag" style="font-size: 0.72rem; padding: 0.1rem 0.4rem;">${escapeHtml(article.category || 'General')}</span>
            <span class="pill-tag" style="font-size: 0.72rem; padding: 0.1rem 0.4rem; font-weight: 700;">${article.quantity || 1} uds</span>
            <span class="pill-tag" style="font-size: 0.72rem; padding: 0.1rem 0.4rem;">⚖️ ${weightText}</span>
            ${batchTagHtml}
          </div>
          <div class="assign-item-footer">
            <span style="font-size: 0.78rem; color: var(--text-muted);">Coste base: <strong>${(article.costEUR || 0).toFixed(2)} €</strong></span>
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--brand);">Venta: ${(article.finalPrice || 0).toFixed(2)} €</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Guarda la asignación masiva de artículos al lote actual.
 */
async function saveBatchAssignHandler() {
  const batchId = AppState.assignBatchId;
  if (!batchId) return;

  const batch = AppState.batches.find(b => b.id === batchId);
  const affectedBatchIds = new Set([batchId]);

  try {
    for (const article of AppState.articles) {
      const shouldBeInBatch = AppState.assignSelectedArticleIds.has(article.id);
      const isCurrentlyInBatch = article.batchId === batchId;

      if (shouldBeInBatch && !isCurrentlyInBatch) {
        if (article.batchId) affectedBatchIds.add(article.batchId);
        article.batchId = batchId;
        article.updatedAt = Date.now();
        await dbSaveArticle(article);
      } else if (!shouldBeInBatch && isCurrentlyInBatch) {
        article.batchId = null;
        article.updatedAt = Date.now();
        await dbSaveArticle(article);
      }
    }

    // Recalcular todos los lotes afectados
    for (const bId of affectedBatchIds) {
      await recalculateBatchArticles(bId);
    }

    renderArticles();
    renderBatchesList();
    populateBatchSelects();
    updateMainBatchesKPIs();
    renderMainBatches();

    document.getElementById('batchAssignModal').style.display = 'none';
    showToast(`Asignación guardada: ${AppState.assignSelectedArticleIds.size} artículos en "${batch ? batch.name : 'lote'}"`, 'success');
  } catch (err) {
    console.error('Error al guardar asignación de lote:', err);
    showToast('Error al guardar la asignación de artículos.', 'error');
  }
}

/**
 * Elimina un lote y desvincula sus artículos.
 */
async function deleteBatch(batchId) {
  const batch = AppState.batches.find(b => b.id === batchId);
  const name = batch ? batch.name : 'este lote';

  if (!confirm(`¿Eliminar el lote "${name}"? Los artículos asociados quedarán sin lote asignado.`)) return;

  try {
    await dbDeleteBatch(batchId);
    AppState.batches = AppState.batches.filter(b => b.id !== batchId);

    // Desvincular artículos
    for (const article of AppState.articles.filter(a => a.batchId === batchId)) {
      const updated = { ...article, batchId: null, updatedAt: Date.now() };
      await dbSaveArticle(updated);
      const idx = AppState.articles.findIndex(a => a.id === article.id);
      if (idx >= 0) AppState.articles[idx] = updated;
    }

    populateBatchSelects();
    // Si estamos dentro del lote eliminado, volver a la pantalla principal
    if (AppState.activeBatchId === batchId) {
      navigateToBatches();
    } else {
      renderArticles();
      renderBatchesList();
      updateMainBatchesKPIs();
      renderMainBatches();
    }
    showToast(`Lote "${name}" eliminado`, 'info');
  } catch (error) {
    console.error('Error al eliminar lote:', error);
    showToast('Error al eliminar el lote', 'error');
  }
}

// Exportar funciones de lote al ámbito global para onclicks inline
window.openBatchEditModal = openBatchEditModal;
window.deleteBatch = deleteBatch;
window.openBatchAssignModal = openBatchAssignModal;
window.toggleAssignArticle = toggleAssignArticle;

// ============================================================
// 12c. NAVEGACIÓN ENTRE VISTAS (HOME LOTES ↔ DETALLE LOTE)
// ============================================================

/**
 * Navega a la pantalla principal de lotes (Vista 1 — Home).
 */
function navigateToBatches() {
  AppState.activeBatchId = null;

  const homeView = document.getElementById('batchesHomeView');
  const detailView = document.getElementById('batchDetailView');
  if (homeView) homeView.style.display = '';
  if (detailView) detailView.style.display = 'none';

  updateMainBatchesKPIs();
  renderMainBatches();
}

/**
 * Navega al detalle de un lote concreto (Vista 2 — Dentro del Lote).
 * @param {string} batchId - ID del lote, o 'NONE' para artículos sin lote.
 */
function navigateToBatchDetail(batchId) {
  AppState.activeBatchId = batchId;
  // Resetear filtros de artículos al entrar a un lote
  AppState.searchTerm = '';
  AppState.filterCategory = 'ALL';
  AppState.filterStatus = 'ALL';
  AppState.sortBy = 'date_desc';
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  const fc = document.getElementById('filterCategory');
  if (fc) fc.value = 'ALL';
  const fs = document.getElementById('filterStatus');
  if (fs) fs.value = 'ALL';
  const sb = document.getElementById('sortBy');
  if (sb) sb.value = 'date_desc';

  const homeView = document.getElementById('batchesHomeView');
  const detailView = document.getElementById('batchDetailView');
  if (homeView) homeView.style.display = 'none';
  if (detailView) detailView.style.display = '';

  // Actualizar cabecera del detalle
  const titleEl = document.getElementById('batchDetailTitle');
  const metaEl = document.getElementById('batchDetailMeta');

  if (batchId === 'NONE') {
    if (titleEl) titleEl.textContent = 'Artículos sin Lote';
    if (metaEl) metaEl.innerHTML = '<span class="batch-status-badge" style="background:rgba(100,116,139,0.1);color:var(--text-muted);border:1px solid var(--border-subtle);">Sin asignar</span>';
    // Ocultar botones de lote específico
    const btnAssign = document.getElementById('btnBatchDetailAssign');
    const btnEdit = document.getElementById('btnBatchDetailEdit');
    const btnEmptyAssign = document.getElementById('btnEmptyAssign');
    if (btnAssign) btnAssign.style.display = 'none';
    if (btnEdit) btnEdit.style.display = 'none';
    if (btnEmptyAssign) btnEmptyAssign.style.display = 'none';
  } else {
    const batch = AppState.batches.find(b => b.id === batchId);
    if (batch) {
      if (titleEl) titleEl.textContent = batch.name;
      const statusLabels = {
        EN_PREPARACION: '<span class="batch-status-badge badge-prep">En preparación</span>',
        EN_CAMINO: '<span class="batch-status-badge badge-transit">En camino ✈</span>',
        RECIBIDO: '<span class="batch-status-badge badge-received">Recibido ✓</span>'
      };
      const trackingHtml = batch.tracking
        ? `<span class="batch-tracking-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="10" x="2" y="3" rx="2"/><path d="M10 3v4"/><path d="M2 13h3"/><path d="M19 13h3"/><path d="M10 17v4"/></svg> ${escapeHtml(batch.tracking)}</span>`
        : '';
      const weightHtml = batch.totalWeight
        ? `<span class="batch-tracking-pill">⚖️ ${batch.totalWeight.toFixed(2)} kg lote</span>`
        : '';
      if (metaEl) metaEl.innerHTML = `${statusLabels[batch.status] || ''} ${trackingHtml} ${weightHtml}`;
    }
    const btnAssign = document.getElementById('btnBatchDetailAssign');
    const btnEdit = document.getElementById('btnBatchDetailEdit');
    const btnEmptyAssign = document.getElementById('btnEmptyAssign');
    if (btnAssign) btnAssign.style.display = '';
    if (btnEdit) btnEdit.style.display = '';
    if (btnEmptyAssign) btnEmptyAssign.style.display = '';
  }

  renderArticles();
}

/**
 * Calcula los KPIs globales de la pantalla principal de lotes.
 */
function updateMainBatchesKPIs() {
  const allArticles = AppState.articles;
  const totalBatches = AppState.batches.length;
  const totalArticles = allArticles.length;
  const totalUnits = allArticles.reduce((s, a) => s + (a.quantity || 1), 0);
  const totalCost = allArticles.reduce((s, a) => s + (a.totalCostEUR || 0) * (a.quantity || 1), 0);
  const totalShipping = AppState.batches.reduce((s, b) => s + (b.totalShippingCost || 0), 0);
  const totalRevenue = allArticles.reduce((s, a) => s + (a.finalPrice || 0) * (a.quantity || 1), 0);
  const totalProfit = allArticles.reduce((s, a) => s + (a.netProfit || 0) * (a.quantity || 1), 0);
  const totalWeight = AppState.batches.reduce((s, b) => s + (b.totalWeight || 0), 0);
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const el = (id) => document.getElementById(id);

  if (el('kpiMainTotalBatches')) el('kpiMainTotalBatches').textContent = totalBatches;
  if (el('kpiMainTotalUnits')) el('kpiMainTotalUnits').textContent = `${totalArticles} artículos · ${totalUnits} uds`;
  if (el('kpiMainTotalCost')) el('kpiMainTotalCost').textContent = formatCurrency(totalCost);
  if (el('kpiMainTotalShipping')) el('kpiMainTotalShipping').textContent = `${formatCurrency(totalShipping)} en envíos`;
  if (el('kpiMainTotalRevenue')) el('kpiMainTotalRevenue').textContent = formatCurrency(totalRevenue);
  if (el('kpiMainTotalWeight')) el('kpiMainTotalWeight').textContent = `⚖️ ${totalWeight.toFixed(2)} kg calculados`;

  const profitEl = el('kpiMainTotalProfit');
  if (profitEl) {
    profitEl.textContent = (totalProfit >= 0 ? '+' : '') + formatCurrency(totalProfit);
    profitEl.className = totalProfit >= 0 ? 'kpi-value green-text' : 'kpi-value text-danger';
  }
  if (el('kpiMainAverageMargin')) el('kpiMainAverageMargin').textContent = `Margen medio: ${avgMargin.toFixed(1)}%`;
}

/**
 * Renderiza la cuadrícula de lotes en la pantalla principal (Vista 1).
 */
function renderMainBatches() {
  const grid = document.getElementById('batchesGridMain');
  const emptyState = document.getElementById('batchesEmptyState');
  if (!grid) return;

  // Filtrar lotes según búsqueda y estado
  let batches = [...AppState.batches];
  if (AppState.batchSearchTerm.trim()) {
    const term = AppState.batchSearchTerm.toLowerCase();
    batches = batches.filter(b =>
      b.name.toLowerCase().includes(term) ||
      (b.tracking && b.tracking.toLowerCase().includes(term))
    );
  }
  if (AppState.batchStatusFilter !== 'ALL') {
    batches = batches.filter(b => b.status === AppState.batchStatusFilter);
  }

  const unassigned = AppState.articles.filter(a => !a.batchId);

  if (batches.length === 0 && unassigned.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const statusBadge = {
    EN_PREPARACION: '<span class="batch-status-badge badge-prep">En preparación</span>',
    EN_CAMINO: '<span class="batch-status-badge badge-transit">En camino ✈</span>',
    RECIBIDO: '<span class="batch-status-badge badge-received">Recibido ✓</span>'
  };

  let html = batches.map(batch => {
    const bArticles = AppState.articles.filter(a => a.batchId === batch.id);
    const bUnits = bArticles.reduce((s, a) => s + (a.quantity || 1), 0);
    const bCost = bArticles.reduce((s, a) => s + (a.totalCostEUR || 0) * (a.quantity || 1), 0);
    const bRevenue = bArticles.reduce((s, a) => s + (a.finalPrice || 0) * (a.quantity || 1), 0);
    const bProfit = bArticles.reduce((s, a) => s + (a.netProfit || 0) * (a.quantity || 1), 0);
    const bWeightKg = bArticles.reduce((s, a) => s + ((a.weight || 0) * (a.quantity || 1)), 0) / 1000;
    const margin = bRevenue > 0 ? (bProfit / bRevenue * 100) : 0;
    const profitColor = bProfit >= 0 ? 'var(--emerald-text, #059669)' : 'var(--rose, #f43f5e)';
    const profitSign = bProfit >= 0 ? '+' : '';

    return `
      <div class="batch-main-card" onclick="navigateToBatchDetail('${batch.id}')">
        <div class="batch-card-top">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
            ${statusBadge[batch.status] || ''}
          </div>
          <h3 class="batch-main-title">${escapeHtml(batch.name)}</h3>
          ${batch.tracking ? `<div class="batch-tracking-pill">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="10" x="2" y="3" rx="2"/><path d="M10 3v4"/><path d="M2 13h3"/><path d="M19 13h3"/><path d="M10 17v4"/></svg>
            ${escapeHtml(batch.tracking)}
          </div>` : ''}
        </div>
        <div class="batch-main-stats-grid">
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Artículos</span>
            <span class="batch-stat-val">${bArticles.length} · ${bUnits} uds</span>
          </div>
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">⚖️ Peso</span>
            <span class="batch-stat-val">${bWeightKg > 0 ? bWeightKg.toFixed(2) + ' kg' : (batch.totalWeight ? batch.totalWeight.toFixed(2) + ' kg' : '—')}</span>
          </div>
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Inversión</span>
            <span class="batch-stat-val" style="color:var(--amber-text,#b45309);">${formatCurrency(bCost)}</span>
          </div>
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Beneficio est.</span>
            <span class="batch-stat-val" style="color:${profitColor};font-weight:700;">${profitSign}${formatCurrency(bProfit)}</span>
          </div>
        </div>
        <div class="batch-card-bottom">
          <small class="text-muted">Envío: ${formatCurrency(batch.totalShippingCost || 0)} · Margen: ${margin.toFixed(1)}%</small>
          <div class="batch-card-actions-quick" onclick="event.stopPropagation()">
            <button class="btn btn-secondary btn-sm" onclick="openBatchAssignModal('${batch.id}')" title="Asignar artículos con el ratón">📦</button>
            <button class="btn btn-secondary btn-sm" onclick="openBatchEditModal('${batch.id}')" title="Editar lote">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn btn-danger-outline btn-sm" onclick="deleteBatch('${batch.id}')" title="Eliminar lote">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
          <button class="batch-card-enter-btn" onclick="navigateToBatchDetail('${batch.id}')">Ver artículos →</button>
        </div>
      </div>
    `;
  }).join('');

  // Tarjeta de artículos sin lote
  if (unassigned.length > 0) {
    const uRevenue = unassigned.reduce((s, a) => s + (a.finalPrice || 0) * (a.quantity || 1), 0);
    const uProfit = unassigned.reduce((s, a) => s + (a.netProfit || 0) * (a.quantity || 1), 0);
    const uUnits = unassigned.reduce((s, a) => s + (a.quantity || 1), 0);
    html += `
      <div class="batch-main-card unassigned-card" onclick="navigateToBatchDetail('NONE')">
        <div class="batch-card-top">
          <div style="margin-bottom:0.35rem;">
            <span class="batch-status-badge" style="background:rgba(100,116,139,0.1);color:var(--text-muted);border:1px solid var(--border-subtle);">Sin asignar</span>
          </div>
          <h3 class="batch-main-title" style="color:var(--text-secondary);">Artículos sin Lote</h3>
          <div style="font-size:0.78rem;color:var(--text-muted);">Artículos pendientes de asignar a un lote</div>
        </div>
        <div class="batch-main-stats-grid">
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Artículos</span>
            <span class="batch-stat-val">${unassigned.length} · ${uUnits} uds</span>
          </div>
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Venta pot.</span>
            <span class="batch-stat-val">${formatCurrency(uRevenue)}</span>
          </div>
          <div class="batch-stat-box">
            <span class="batch-stat-lbl">Beneficio est.</span>
            <span class="batch-stat-val" style="color:${uProfit >= 0 ? 'var(--emerald-text,#059669)' : 'var(--rose,#f43f5e)'};">${uProfit >= 0 ? '+' : ''}${formatCurrency(uProfit)}</span>
          </div>
        </div>
        <div class="batch-card-bottom">
          <button class="batch-card-enter-btn">Ver artículos →</button>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
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
  document.getElementById('btnEmptyAdd')?.addEventListener('click', () => openArticleModal());
  document.getElementById('btnLoadDemo')?.addEventListener('click', () => loadDemoData());

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
    if (confirm('¿Estás seguro de que deseas eliminar TODOS los artículos y lotes del catálogo? Esta acción no se puede deshacer.')) {
      await dbClearAllArticles();
      AppState.articles = [];
      AppState.batches = [];
      populateBatchSelects();
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

  // ---- Lotes y Envíos Consolidados ----
  // Abrir modal de listado de lotes
  document.getElementById('btnOpenBatchesModal')?.addEventListener('click', () => {
    renderBatchesList();
    document.getElementById('batchesModal').style.display = 'flex';
  });

  document.getElementById('btnCloseBatchesModal')?.addEventListener('click', () => {
    document.getElementById('batchesModal').style.display = 'none';
  });

  // Botón Nuevo Lote dentro del modal de listado
  document.getElementById('btnCreateNewBatch')?.addEventListener('click', () => {
    openBatchEditModal(null);
  });

  // Botón + Nuevo Lote rápido desde el formulario de artículo
  document.getElementById('btnQuickCreateBatch')?.addEventListener('click', () => {
    openBatchEditModal(null);
  });

  // Cerrar modal de edición de lote
  document.getElementById('btnCloseBatchEditModal')?.addEventListener('click', () => {
    document.getElementById('batchEditModal').style.display = 'none';
    AppState.editingBatchId = null;
  });

  document.getElementById('btnCancelBatchEdit')?.addEventListener('click', () => {
    document.getElementById('batchEditModal').style.display = 'none';
    AppState.editingBatchId = null;
  });

  // Submit del formulario de lote
  document.getElementById('batchForm')?.addEventListener('submit', saveBatchHandler);

  // Cambio de lote en el modal de artículo → actualizar nota de envío prorrateado
  document.getElementById('inputBatchId')?.addEventListener('change', (e) => {
    updateBatchShippingNote(e.target.value);
  });

  // Filtro por lote en la barra de filtros
  document.getElementById('filterBatch')?.addEventListener('change', (e) => {
    AppState.filterBatch = e.target.value;
    renderArticles();
  });

  // Enlace Goofish: tester en vivo
  const inputGoofishUrl = document.getElementById('inputGoofishUrl');
  const linkTestGoofish = document.getElementById('linkTestGoofish');
  if (inputGoofishUrl && linkTestGoofish) {
    inputGoofishUrl.addEventListener('input', () => {
      const val = inputGoofishUrl.value.trim();
      if (val) {
        linkTestGoofish.href = val;
        linkTestGoofish.style.display = 'inline';
      } else {
        linkTestGoofish.style.display = 'none';
      }
    });
  }

  // ---- Modal de Asignación Visual de Artículos a Lote ----
  document.getElementById('btnCloseBatchAssignModal')?.addEventListener('click', () => {
    document.getElementById('batchAssignModal').style.display = 'none';
  });
  document.getElementById('btnCancelBatchAssign')?.addEventListener('click', () => {
    document.getElementById('batchAssignModal').style.display = 'none';
  });
  document.getElementById('btnSaveBatchAssign')?.addEventListener('click', saveBatchAssignHandler);

  const batchAssignSearch = document.getElementById('batchAssignSearch');
  if (batchAssignSearch) {
    batchAssignSearch.addEventListener('input', (e) => {
      AppState.assignSearchTerm = e.target.value;
      renderBatchAssignItems();
    });
  }

  document.getElementById('btnAssignSelectUnassigned')?.addEventListener('click', () => {
    AppState.articles.forEach(a => {
      if (!a.batchId) AppState.assignSelectedArticleIds.add(a.id);
    });
    renderBatchAssignItems();
  });

  document.getElementById('btnAssignSelectAll')?.addEventListener('click', () => {
    AppState.articles.forEach(a => AppState.assignSelectedArticleIds.add(a.id));
    renderBatchAssignItems();
  });

  document.getElementById('btnAssignDeselectAll')?.addEventListener('click', () => {
    AppState.assignSelectedArticleIds.clear();
    renderBatchAssignItems();
  });

  document.getElementById('btnOpenAssignFromBatchEdit')?.addEventListener('click', () => {
    if (AppState.editingBatchId) {
      openBatchAssignModal(AppState.editingBatchId);
    } else {
      showToast('Guarda el lote primero para poder asignarle artículos.', 'warning');
    }
  });

  // ---- Navegación de Vistas: Home Lotes ↔ Detalle Lote ----
  document.getElementById('btnBackToBatches')?.addEventListener('click', () => navigateToBatches());
  document.getElementById('btnNavBatchesHome')?.addEventListener('click', () => navigateToBatches());

  document.getElementById('btnNavNewBatch')?.addEventListener('click', () => openBatchEditModal(null));
  document.getElementById('btnMainCreateBatch')?.addEventListener('click', () => openBatchEditModal(null));
  document.getElementById('btnEmptyCreateBatch')?.addEventListener('click', () => openBatchEditModal(null));

  document.getElementById('btnLoadDemoMain')?.addEventListener('click', async () => {
    await dbClearAllArticles();
    AppState.articles = [];
    AppState.batches = [];
    await loadDemoData();
  });

  document.getElementById('btnBatchDetailAssign')?.addEventListener('click', () => {
    if (AppState.activeBatchId && AppState.activeBatchId !== 'NONE') {
      openBatchAssignModal(AppState.activeBatchId);
    }
  });

  document.getElementById('btnBatchDetailEdit')?.addEventListener('click', () => {
    if (AppState.activeBatchId && AppState.activeBatchId !== 'NONE') {
      openBatchEditModal(AppState.activeBatchId);
    }
  });

  document.getElementById('btnBatchDetailAddArticle')?.addEventListener('click', () => openArticleModal());

  document.getElementById('btnEmptyAssign')?.addEventListener('click', () => {
    if (AppState.activeBatchId && AppState.activeBatchId !== 'NONE') {
      openBatchAssignModal(AppState.activeBatchId);
    } else {
      navigateToBatches();
    }
  });

  // Búsqueda y filtro de lotes en la pantalla Home
  const batchSearchInput = document.getElementById('batchSearchInput');
  if (batchSearchInput) {
    batchSearchInput.addEventListener('input', (e) => {
      AppState.batchSearchTerm = e.target.value;
      renderMainBatches();
    });
  }

  const batchStatusFilter = document.getElementById('batchStatusFilter');
  if (batchStatusFilter) {
    batchStatusFilter.addEventListener('change', (e) => {
      AppState.batchStatusFilter = e.target.value;
      renderMainBatches();
    });
  }
}

// ============================================================
// 14. UTILIDADES Y NOTIFICACIONES (TOAST)
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>'
  };

  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
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
window.navigateToBatches = navigateToBatches;
window.navigateToBatchDetail = navigateToBatchDetail;
