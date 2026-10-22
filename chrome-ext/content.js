(function () {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────────
  const CONFIG = {
    MAX_RETRIES: 3,
    DELAY_MS: 1200,
    COOLDOWN_MS: 30000,
    OBSERVER_TIMEOUT_MS: 15000,
    DEFAULT_GRID_COLS: '5',
    TILE_SELECTOR: '[data-testid^="feed-tile-"]',
    LOAD_MORE_BUTTON_TEXT: 'View More Offers',
    CACHE_KEY: 'c1ext_deals_cache',
  };

  // ── State ──────────────────────────────────────────────────────────
  let allTiles = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let sortHighest = false;
  let isLoading = false;
  let sessionData = null;
  const reactTileMap = new Map();

  // ── Card Template ──────────────────────────────────────────────────
  const cardTemplate = document.createElement('div');
  cardTemplate.className = 'c1ext-tile';
  cardTemplate.setAttribute('role', 'button');
  cardTemplate.setAttribute('tabindex', '0');
  cardTemplate.innerHTML = `
    <div class="c1ext-tile-inner">
      <div class="c1ext-tile-logo-wrap"><img class="c1ext-tile-logo" loading="lazy" alt=""></div>
      <div class="c1ext-tile-merchant"></div>
      <div class="c1ext-tile-location"></div>
      <div class="c1ext-tile-reward"></div>
    </div>
  `;

  // ── Helpers ────────────────────────────────────────────────────────
  const delay = ms => new Promise(r => setTimeout(r, ms));

  function isFeedPage() {
    return location.pathname.startsWith('/feed') && !location.pathname.includes('/offers/');
  }

  function parseRewardValue(text) {
    if (!text) return 0;
    const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([xX%]|miles|\$)?/);
    return m ? parseFloat(m[1]) : 0;
  }

  function classifyRewardType(text) {
    const t = (text || '').toLowerCase().replace(/,/g, '');
    const isUpTo = t.includes('up to');
    if (t.includes('%') && t.includes('back')) return 'percent';
    if (t.includes('$') && t.includes('back')) return isUpTo ? 'dollar-upto' : 'dollar-flat';
    if (/\d+\s*x\b/.test(t) && t.includes('miles')) return 'miles-rate';
    if (t.includes('miles')) return isUpTo ? 'miles-upto' : 'miles-flat';
    return 'other';
  }

  // ── Cache Storage ──────────────────────────────────────────────────
  function saveCache(deals, session) {
    try {
      const data = JSON.stringify({ deals, session });
      localStorage.setItem(CONFIG.CACHE_KEY, data);
      sessionStorage.setItem(CONFIG.CACHE_KEY, data);
    } catch {}
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_KEY) || sessionStorage.getItem(CONFIG.CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { deals: parsed, session: null };
      if (parsed && Array.isArray(parsed.deals) && parsed.deals.length > 0) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function clearCache() {
    try {
      localStorage.removeItem(CONFIG.CACHE_KEY);
      sessionStorage.removeItem(CONFIG.CACHE_KEY);
    } catch {}
  }

  // ── Session & Navigation ───────────────────────────────────────────
  function getSessionData() {
    try {
      const s = window.__reactRouterContext?.state?.loaderData?.root?.maybeUserSession ||
                window.__reactRouterDataRouter?.state?.loaderData?.root?.maybeUserSession ||
                window.__remixContext?.state?.loaderData?.root?.maybeUserSession;

      let arid = s?.maybeSelectedArid || s?.arids?.[0];
      let viewInstanceId = s?.viewInstanceId;
      let contentSlug = s?.contentSlug;
      let cols = CONFIG.DEFAULT_GRID_COLS;

      for (const entry of performance.getEntriesByType('resource')) {
        const m = entry.name?.match(/\/feed\/([^/?#]+)/);
        if (m) {
          const url = new URL(entry.name);
          arid = arid || decodeURIComponent(m[1]);
          viewInstanceId = viewInstanceId || url.searchParams.get('viewInstanceId');
          contentSlug = contentSlug || url.searchParams.get('contentSlug') || url.searchParams.get('initialContentSlug');
          cols = url.searchParams.get('numberOfColumnsInGrid') || cols;
          if (arid && viewInstanceId && contentSlug) break;
        }
      }

      if (!viewInstanceId || !contentSlug) {
        const q = new URLSearchParams(window.location.search);
        viewInstanceId = viewInstanceId || q.get('viewInstanceId');
        contentSlug = contentSlug || q.get('contentSlug') || q.get('initialContentSlug');
        cols = q.get('numberOfColumnsInGrid') || cols;
      }

      return (arid && viewInstanceId && contentSlug)
        ? { arid, viewInstanceId, contentSlug, numberOfColumnsInGrid: cols }
        : null;
    } catch {
      return null;
    }
  }

  function buildFeedOfferId(tile) {
    if (!sessionData) return '';
    return btoa(JSON.stringify({
      v: 1,
      viewContext: JSON.stringify({
        id: sessionData.viewInstanceId,
        org: 'capitaloneoffers',
        src: sessionData.contentSlug,
        rwd: 'feed',
      }),
      inventory: { source: tile.type?.toLowerCase() || 'standard', merchantTLD: tile.merchantTLD },
      offers: Array.isArray(tile.offers) ? tile.offers : ['affiliate'],
    }));
  }

  function handleTileClick(tile) {
    if (tile.redirectUrl) {
      window.open(tile.redirectUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (sessionData) {
      const feedOfferId = tile.id || buildFeedOfferId(tile);
      if (feedOfferId) {
        const url = `/feed/${encodeURIComponent(sessionData.arid)}/offers/${feedOfferId}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    const reactTile = reactTileMap.get(tile.merchantTLD);
    if (reactTile) {
      reactTile.click();
    }
  }

  // ── Deal Extraction & API Fetching ─────────────────────────────────
  function extractTiles(data) {
    if (!Array.isArray(data)) return [];
    const results = [];

    function add(t, defaultType) {
      if (!t?.merchantTLD) return;
      let r = (t.buttonText || '').trim();
      if (t.rateText && (!r || /^(shop now|learn more|view offer|redeem)/i.test(r))) {
        r = t.rateText.trim();
      }
      results.push({
        merchantTLD: t.merchantTLD,
        merchantDisplayName: t.merchantDisplayName || t.merchantTLD,
        text: t.text || 'Online',
        buttonText: r || t.rateText || '',
        imageSrc: (t.imageSrc && t.imageSrc.startsWith('https://')) ? t.imageSrc : '',
        id: t.id,
        offers: t.offers || t.offerSources,
        type: t.type || defaultType || 'Standard',
        redirectUrl: t.redirectUrl,
      });
    }

    for (const item of data) {
      if (!item) continue;
      if (item.type === 'Carousel' && Array.isArray(item.tiles)) {
        item.tiles.forEach(sub => add(sub, 'Carousel'));
      } else {
        add(item, item.type);
      }
    }
    return results;
  }

  async function fetchAllDeals(session, onProgress) {
    const tiles = [];
    const seen = new Set();
    let cursor = null;

    while (true) {
      const p = new URLSearchParams({
        numberOfColumnsInGrid: session.numberOfColumnsInGrid || CONFIG.DEFAULT_GRID_COLS,
        viewInstanceId: session.viewInstanceId,
        contentSlug: session.contentSlug,
      });
      if (cursor) p.append('cursor', cursor);

      const url = `/feed/${encodeURIComponent(session.arid)}?${p.toString()}`;
      let resp;
      let retries = 0;

      while (true) {
        try {
          resp = await fetch(url, { credentials: 'include', headers: { Accept: '*/*' } });
        } catch {
          throw new Error('Network error — please check your connection.');
        }

        if (resp.status === 429) {
          retries++;
          if (retries > CONFIG.MAX_RETRIES) {
            if (tiles.length > 0) return tiles;
            throw new Error('Rate limit reached — please wait a moment and try again.');
          }
          const retryAfter = parseInt(resp.headers.get('Retry-After'), 10);
          const waitMs = (!isNaN(retryAfter) && retryAfter > 0 && retryAfter <= 60)
            ? retryAfter * 1000
            : CONFIG.COOLDOWN_MS * retries;

          updateProgress(`Rate limited — cooling down ${Math.round(waitMs / 1000)}s...`);
          await delay(waitMs);
          continue;
        }
        break;
      }

      if (resp.status === 401 || resp.status === 403) throw new Error('Session expired — please refresh.');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const page = await resp.json().catch(() => { throw new Error('Unexpected API response.'); });

      for (const t of extractTiles(page.data)) {
        const key = `${t.merchantTLD}::${t.buttonText}`;
        if (!seen.has(key)) {
          seen.add(key);
          t._rewardType = classifyRewardType(t.buttonText);
          t._rewardValue = parseRewardValue(t.buttonText);
          tiles.push(t);
        }
      }
      onProgress(tiles.length);

      if (!page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
      await delay(CONFIG.DELAY_MS);
    }

    return tiles;
  }

  // ── DOM Helpers & Card Rendering ───────────────────────────────────
  function buildReactTileMap() {
    reactTileMap.clear();
    document.querySelectorAll(CONFIG.TILE_SELECTOR).forEach(el => {
      try {
        const data = JSON.parse(atob(el.dataset.testid.slice(10)));
        const merchant = data.inventory?.merchantTLD;
        if (merchant) reactTileMap.set(merchant, el);
      } catch {}
    });
  }

  function findGridContainer() {
    return document.querySelector(CONFIG.TILE_SELECTOR)?.parentElement || null;
  }

  function findLoadMoreButton() {
    return Array.from(document.querySelectorAll('button')).find(
      b => b.textContent.trim() === CONFIG.LOAD_MORE_BUTTON_TEXT
    );
  }

  function hideVanillaTiles(hide) {
    document.querySelectorAll(CONFIG.TILE_SELECTOR).forEach(el => {
      el.classList.toggle('c1ext-hidden', hide);
    });
    findLoadMoreButton()?.classList.toggle('c1ext-hidden', hide);
  }

  function buildCard(tile) {
    const card = cardTemplate.cloneNode(true);
    card._tileData = tile;

    const img = card.querySelector('.c1ext-tile-logo');
    if (tile.imageSrc) {
      img.src = tile.imageSrc;
      img.alt = tile.merchantTLD || '';
    } else {
      img.remove();
    }

    card.querySelector('.c1ext-tile-merchant').textContent = tile.merchantDisplayName || tile.merchantTLD;
    card.querySelector('.c1ext-tile-location').textContent = tile.text || 'Online';
    card.querySelector('.c1ext-tile-reward').textContent = tile.buttonText || '';

    return card;
  }

  function matchesSearch(tile, query) {
    if (!query) return true;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const hay = `${tile.merchantDisplayName || ''} ${tile.merchantTLD || ''} ${tile.text || ''} ${tile.buttonText || ''}`.toLowerCase();
    return terms.every(term => hay.includes(term));
  }

  function renderGrid() {
    const grid = document.getElementById('c1ext-grid');
    if (!grid) return;

    let visible = allTiles.filter(t =>
      (currentFilter === 'all' || t._rewardType === currentFilter) && matchesSearch(t, searchQuery)
    );

    if (sortHighest) {
      visible = [...visible].sort((a, b) => b._rewardValue - a._rewardValue);
    }

    const frag = document.createDocumentFragment();
    if (visible.length === 0 && allTiles.length > 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'c1ext-no-results';
      emptyDiv.textContent = 'No deals found';
      frag.appendChild(emptyDiv);
    } else {
      for (const t of visible) frag.appendChild(buildCard(t));
    }
    grid.replaceChildren(frag);
  }

  function updateProgress(msg) {
    const el = document.getElementById('c1ext-progress-text');
    if (el) el.textContent = msg;
  }

  function showError(msg) {
    const toolbar = document.getElementById('c1ext-toolbar');
    if (!toolbar) return;
    toolbar.querySelector('.c1ext-error')?.remove();
    const err = document.createElement('div');
    err.className = 'c1ext-error';
    err.textContent = msg;
    toolbar.appendChild(err);

    const btn = document.getElementById('c1ext-load-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  }

  function setLoadedUI(isLoaded) {
    hideVanillaTiles(isLoaded);

    const btn = document.getElementById('c1ext-load-btn');
    const reloadBtn = document.getElementById('c1ext-reload-btn');
    const progress = document.getElementById('c1ext-progress');
    const searchInput = document.getElementById('c1ext-search-input');
    const filters = document.getElementById('c1ext-filters');

    if (btn) {
      btn.textContent = isLoaded ? `\u2713 All ${allTiles.length} Deals Loaded` : 'Load All Deals';
      btn.disabled = isLoaded;
    }
    if (reloadBtn) reloadBtn.hidden = !isLoaded;
    if (progress) progress.hidden = isLoaded;
    if (searchInput) searchInput.hidden = !isLoaded;
    if (filters) filters.hidden = !isLoaded;
  }

  // ── Toolbar Injection ──────────────────────────────────────────────
  function injectToolbar(container) {
    if (document.getElementById('c1ext-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'c1ext-toolbar';
    toolbar.innerHTML = `
      <div id="c1ext-controls">
        <button id="c1ext-load-btn" class="c1ext-btn-primary" type="button">Load All Deals</button>
        <button id="c1ext-reload-btn" class="c1ext-btn-secondary" type="button" hidden title="Clear cache and reprocess fresh deals from API">&#x21bb; Reload Deals</button>
        <input type="search" id="c1ext-search-input" class="c1ext-search-input" placeholder="Search loaded deals..." autocomplete="off" spellcheck="false" hidden>
        <span id="c1ext-progress" hidden>
          <span class="c1ext-spinner"></span>
          <span id="c1ext-progress-text">Loading...</span>
        </span>
      </div>
      <div id="c1ext-filters" hidden>
        <span class="c1ext-filter-label">Filter:</span>
        <div class="c1ext-filter-group">
          <button class="c1ext-filter-btn c1ext-active" data-filter="all" type="button">All</button>
          <button class="c1ext-filter-btn" data-filter="percent" type="button">% Back</button>
          <button class="c1ext-filter-btn" data-filter="dollar-upto" type="button">$ Back (Up To)</button>
          <button class="c1ext-filter-btn" data-filter="dollar-flat" type="button">$ Back (Flat)</button>
          <button class="c1ext-filter-btn" data-filter="miles-rate" type="button">Earning Rate</button>
          <button class="c1ext-filter-btn" data-filter="miles-upto" type="button">Bonus Miles (Up To)</button>
          <button class="c1ext-filter-btn" data-filter="miles-flat" type="button">Bonus Miles (Flat)</button>
        </div>
        <label class="c1ext-sort-label">
          <input type="checkbox" id="c1ext-sort-toggle">
          <span>Sort: Highest First</span>
        </label>
      </div>
    `;

    const extGrid = document.createElement('div');
    extGrid.id = 'c1ext-grid';

    extGrid.addEventListener('click', e => {
      const card = e.target.closest('.c1ext-tile');
      if (card?._tileData) handleTileClick(card._tileData);
    });

    container.parentElement.insertBefore(toolbar, container);
    container.parentElement.insertBefore(extGrid, container);

    const searchInput = toolbar.querySelector('#c1ext-search-input');
    searchInput?.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderGrid();
    });

    toolbar.querySelector('.c1ext-filter-group').addEventListener('click', e => {
      const btn = e.target.closest('.c1ext-filter-btn');
      if (!btn || btn.dataset.filter === currentFilter) return;

      toolbar.querySelectorAll('.c1ext-filter-btn').forEach(b => {
        b.classList.toggle('c1ext-active', b === btn);
      });

      currentFilter = btn.dataset.filter;
      renderGrid();
    });

    toolbar.querySelector('#c1ext-sort-toggle').addEventListener('change', e => {
      sortHighest = e.target.checked;
      renderGrid();
    });

    toolbar.querySelector('#c1ext-load-btn').addEventListener('click', () => handleLoadAll(false));
    toolbar.querySelector('#c1ext-reload-btn').addEventListener('click', () => handleLoadAll(true));
  }

  // ── Load & Reload Handler ──────────────────────────────────────────
  async function handleLoadAll(forceRefresh = false) {
    if (isLoading) return;
    isLoading = true;

    const session = getSessionData();
    if (!session) {
      showError('Could not read session data. Please ensure you are logged into Capital One Offers.');
      isLoading = false;
      return;
    }

    if (forceRefresh) {
      clearCache();
      allTiles = [];
    }

    const btn = document.getElementById('c1ext-load-btn');
    const reloadBtn = document.getElementById('c1ext-reload-btn');
    const progress = document.getElementById('c1ext-progress');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading...';
    }
    if (reloadBtn) reloadBtn.hidden = true;
    if (progress) progress.hidden = false;
    updateProgress('Starting...');

    sessionData = session;
    buildReactTileMap();

    try {
      allTiles = await fetchAllDeals(session, count => updateProgress(`Loaded ${count} deals...`));
      saveCache(allTiles, session);
      setLoadedUI(true);
      renderGrid();
    } catch (err) {
      setLoadedUI(false);
      showError(err.message);
    } finally {
      isLoading = false;
    }
  }

  // ── Cache Restoration ──────────────────────────────────────────────
  function restoreCachedDealsIfAvailable() {
    const cached = loadCache();
    if (!cached || !cached.deals || cached.deals.length === 0) return false;

    allTiles = cached.deals;
    sessionData = cached.session || getSessionData();
    buildReactTileMap();
    setLoadedUI(true);
    renderGrid();
    return true;
  }

  // ── Initialization & Cleanup ───────────────────────────────────────
  function resetState() {
    allTiles = [];
    currentFilter = 'all';
    searchQuery = '';
    sortHighest = false;
    isLoading = false;
    reactTileMap.clear();
    sessionData = null;
  }

  function init() {
    if (!isFeedPage()) return;

    document.getElementById('c1ext-toolbar')?.remove();
    document.getElementById('c1ext-grid')?.remove();

    resetState();

    const container = findGridContainer();
    if (container?.parentElement) {
      injectToolbar(container);
      restoreCachedDealsIfAvailable();
    }
  }

  let observer = null;
  function waitAndInit() {
    if (!isFeedPage()) return;

    if (document.querySelector(CONFIG.TILE_SELECTOR)) {
      init();
      return;
    }

    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (document.querySelector(CONFIG.TILE_SELECTOR)) {
        observer.disconnect();
        observer = null;
        init();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, CONFIG.OBSERVER_TIMEOUT_MS);
  }

  // ── Navigation & Cache Restoration Listeners ───────────────────────
  window.addEventListener('pageshow', () => {
    if (isFeedPage()) {
      waitAndInit();
    }
  });

  window.addEventListener('popstate', () => {
    if (isFeedPage()) {
      setTimeout(waitAndInit, 100);
    }
  });

  waitAndInit();
})();
