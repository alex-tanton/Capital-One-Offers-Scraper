(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  let allTiles = [];
  let currentFilter = 'all';
  let sortHighest = false;
  let isLoading = false;
  let reactTileMap = new Map(); // merchantTLD → original React tile element
  let sessionData = null;       // stored at load time for use in click handlers

  // ── Utilities ──────────────────────────────────────────────────────
  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function parseRewardValue(text) {
    if (!text) return 0;
    // Strip commas so "1,000" parses as 1000
    const t = text.replace(/,/g, '');
    // Multiplier: "9X miles" → 9 (sort by multiplier)
    const mult = t.match(/(\d+(?:\.\d+)?)\s*[xX]\b/);
    if (mult) return parseFloat(mult[1]);
    // Percentage: "30% back" → 30
    const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) return parseFloat(pct[1]);
    // Dollar: "$5 back" or "up to $5 back" → 5
    const dollar = t.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (dollar) return parseFloat(dollar[1]);
    // Miles (flat or up-to): "1,000 miles" → 1000
    const num = t.match(/(\d+(?:\.\d+)?)/);
    if (num) return parseFloat(num[1]);
    return 0;
  }

  function classifyRewardType(buttonText) {
    const t = (buttonText || '').toLowerCase().replace(/,/g, '');
    const isUpTo = t.includes('up to');

    if (t.includes('%') && t.includes('back')) return 'percent';

    if (t.includes('$') && t.includes('back')) {
      return isUpTo ? 'dollar-upto' : 'dollar-flat';
    }

    // Earning Rate: multiplier like "9X miles", "3x miles"
    if (/\d+\s*x\b/.test(t) && t.includes('miles')) return 'miles-rate';

    // Bonus Miles: any remaining "miles" mention
    if (t.includes('miles')) {
      return isUpTo ? 'miles-upto' : 'miles-flat';
    }

    return 'other';
  }

  function escapeAttr(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Session Extraction ─────────────────────────────────────────────
  function getSessionData() {
    try {
      const session = window.__remixContext?.state?.loaderData?.root?.maybeUserSession;
      if (!session) return null;
      const arid = session.maybeSelectedArid || (session.arids && session.arids[0]);
      if (!arid || !session.viewInstanceId || !session.contentSlug) return null;
      return {
        arid,
        viewInstanceId: session.viewInstanceId,
        contentSlug: session.contentSlug,
      };
    } catch {
      return null;
    }
  }

  // ── API Pagination ─────────────────────────────────────────────────
  const MAX_RETRIES = 5;

  async function fetchAllDeals(session, onProgress) {
    const tiles = [];
    let cursor = null;

    while (true) {
      const params = new URLSearchParams({
        numberOfColumnsInGrid: '3',
        viewInstanceId: session.viewInstanceId,
        contentSlug: session.contentSlug,
      });
      // Note: URLSearchParams.append already percent-encodes values — do NOT
      // pre-encode the cursor or it will be double-encoded on the wire.
      if (cursor) params.append('cursor', cursor);

      const url = `/feed/${encodeURIComponent(session.arid)}?${params.toString()}`;

      let resp;
      let retries = 0;
      while (true) {
        try {
          resp = await fetch(url, {
            credentials: 'include',
            headers: { Accept: '*/*' },
          });
        } catch (err) {
          throw new Error('NETWORK_ERROR');
        }

        if (resp.status === 429) {
          retries++;
          if (retries > MAX_RETRIES) throw new Error('RATE_LIMITED');
          updateProgress(`Rate limited — retrying (${retries}/${MAX_RETRIES})...`);
          await delay(2000 * retries); // exponential back-off
          continue;
        }
        break; // any non-429 response exits the retry loop
      }

      if (resp.status === 401 || resp.status === 403) throw new Error('SESSION_EXPIRED');
      if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

      let page;
      try {
        page = await resp.json();
      } catch {
        throw new Error('PARSE_ERROR');
      }

      const pageTiles = (page.data || []).filter(t => t.type === 'Standard');
      pageTiles.forEach(t => {
        t._rewardType = classifyRewardType(t.buttonText);
      });
      tiles.push(...pageTiles);
      onProgress(tiles.length);

      if (!page.cursor) break;
      cursor = page.cursor;
      await delay(150);
    }

    return tiles;
  }

  // ── React Tile Map ─────────────────────────────────────────────────
  // Decode each tile's data-testid (base64 JSON) to extract merchantTLD,
  // building a lookup map so we can delegate clicks to React's handlers.
  function buildReactTileMap() {
    reactTileMap = new Map();
    document.querySelectorAll('[data-testid^="feed-tile-"]').forEach(el => {
      try {
        const b64 = el.dataset.testid.replace('feed-tile-', '');
        const data = JSON.parse(atob(b64));
        const merchant = data.inventory?.merchantTLD;
        if (merchant) reactTileMap.set(merchant, el);
      } catch {}
    });
  }

  // Construct the base64 feedOfferId that the Remix route expects.
  // Used only for paginated tiles with no corresponding React element.
  function buildFeedOfferId(tile) {
    const viewContext = JSON.stringify({
      id: sessionData.viewInstanceId,
      src: sessionData.contentSlug,
      rwd: 'feed',
    });
    const offerData = {
      v: 1,
      viewContext,
      inventory: { source: 'standard', merchantTLD: tile.merchantTLD },
      // Use offers array from tile data if present; default to affiliate
      offers: Array.isArray(tile.offers) ? tile.offers : ['affiliate'],
    };
    return btoa(JSON.stringify(offerData));
  }

  function handleTileClick(tile) {
    const reactTile = reactTileMap.get(tile.merchantTLD);
    if (reactTile) {
      // Delegate to the original React element — click() fires even when
      // the element is hidden via display:none; React's root event listener
      // will still receive and handle the event.
      reactTile.click();
    } else if (sessionData && window.__remixRouter) {
      // Paginated tile: construct the offer detail URL and navigate
      const feedOfferId = buildFeedOfferId(tile);
      const url = `/feed/${encodeURIComponent(sessionData.arid)}/offers/${feedOfferId}`;
      window.__remixRouter.navigate(url);
    }
  }

  // ── DOM Helpers ────────────────────────────────────────────────────
  function findGridContainer() {
    const firstTile = document.querySelector('[data-testid^="feed-tile-"]');
    return firstTile ? firstTile.parentElement : null;
  }

  function findLoadMoreButton() {
    return Array.from(document.querySelectorAll('button')).find(
      b => b.textContent.trim() === 'View More Offers'
    );
  }

  // ── Card Builder ───────────────────────────────────────────────────
  function buildCard(tile) {
    const card = document.createElement('div');
    card.className = 'c1ext-tile';
    card.dataset.rewardType = tile._rewardType;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    // Only allow https:// image URLs to prevent javascript: or data: URI injection
    const rawSrc = tile.imageSrc || '';
    const imgSrc = rawSrc.startsWith('https://') ? escapeAttr(rawSrc) : '';
    const altText = escapeAttr(tile.merchantTLD);
    const location = escapeHtml(tile.text);
    const reward = escapeHtml(tile.buttonText);
    const merchant = escapeHtml(tile.merchantTLD);

    card.innerHTML = `
      <div class="c1ext-tile-inner">
        <div class="c1ext-tile-logo-wrap">
          ${imgSrc ? `<img class="c1ext-tile-logo" src="${imgSrc}" alt="${altText}" loading="lazy">` : ''}
        </div>
        <div class="c1ext-tile-merchant">${merchant}</div>
        <div class="c1ext-tile-location">${location}</div>
        <div class="c1ext-tile-reward">${reward}</div>
      </div>
    `;

    card.addEventListener('click', () => handleTileClick(tile));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTileClick(tile);
      }
    });

    return card;
  }

  // ── Render ─────────────────────────────────────────────────────────
  function renderGrid() {
    const grid = document.getElementById('c1ext-grid');
    if (!grid) return;

    let visible = allTiles.filter(t =>
      currentFilter === 'all' || t._rewardType === currentFilter
    );

    if (sortHighest) {
      visible = [...visible].sort(
        (a, b) => parseRewardValue(b.buttonText) - parseRewardValue(a.buttonText)
      );
    }

    // Use DocumentFragment for efficient bulk DOM insertion
    const frag = document.createDocumentFragment();
    visible.forEach(t => frag.appendChild(buildCard(t)));
    grid.replaceChildren(frag);

    const visibleEl = document.getElementById('c1ext-visible');
    const totalEl = document.getElementById('c1ext-total');
    if (visibleEl) visibleEl.textContent = visible.length;
    if (totalEl) totalEl.textContent = allTiles.length;
  }

  // ── UI Updates ─────────────────────────────────────────────────────
  function updateProgress(msg) {
    const el = document.getElementById('c1ext-progress-text');
    if (el) el.textContent = msg;
  }

  function showError(msg) {
    const toolbar = document.getElementById('c1ext-toolbar');
    if (!toolbar) return;

    // Remove any existing error
    const existing = toolbar.querySelector('.c1ext-error');
    if (existing) existing.remove();

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

  // ── Toolbar Injection ──────────────────────────────────────────────
  function injectToolbar(container) {
    if (document.getElementById('c1ext-toolbar')) return; // already injected

    const toolbar = document.createElement('div');
    toolbar.id = 'c1ext-toolbar';
    toolbar.setAttribute('aria-label', 'Capital One Offers Loader controls');
    toolbar.innerHTML = `
      <div id="c1ext-controls">
        <button id="c1ext-load-btn" class="c1ext-btn-primary" type="button">
          Load All Deals
        </button>
        <span id="c1ext-progress" hidden>
          <span class="c1ext-spinner" aria-hidden="true"></span>
          <span id="c1ext-progress-text">Loading...</span>
        </span>
      </div>
      <div id="c1ext-filters" hidden>
        <span class="c1ext-filter-label">Filter by reward type:</span>
        <div class="c1ext-filter-group" role="group" aria-label="Filter deals">
          <button class="c1ext-filter-btn c1ext-active" data-filter="all"         type="button">All</button>
          <button class="c1ext-filter-btn"               data-filter="percent"    type="button">% Back</button>
          <button class="c1ext-filter-btn"               data-filter="dollar-upto"  type="button">$ Back (Up To)</button>
          <button class="c1ext-filter-btn"               data-filter="dollar-flat"  type="button">$ Back (Flat)</button>
          <button class="c1ext-filter-btn"               data-filter="miles-rate" type="button">Earning Rate</button>
          <button class="c1ext-filter-btn"               data-filter="miles-upto" type="button">Bonus Miles (Up To)</button>
          <button class="c1ext-filter-btn"               data-filter="miles-flat" type="button">Bonus Miles (Flat)</button>
        </div>
        <label class="c1ext-sort-label">
          <input type="checkbox" id="c1ext-sort-toggle">
          <span>Sort: Highest First</span>
        </label>
      </div>
      <div id="c1ext-summary" hidden>
        Showing <strong><span id="c1ext-visible">0</span></strong> of
        <strong><span id="c1ext-total">0</span></strong> deals
      </div>
    `;

    // Extension grid — sibling of the original grid container
    const extGrid = document.createElement('div');
    extGrid.id = 'c1ext-grid';
    extGrid.setAttribute('aria-label', 'Capital One deals');

    // Insert toolbar and extension grid BEFORE the original grid container
    container.parentElement.insertBefore(toolbar, container);
    container.parentElement.insertBefore(extGrid, container);

    // Wire up events
    document.getElementById('c1ext-load-btn').addEventListener('click', handleLoadAll);

    document.querySelectorAll('.c1ext-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.c1ext-filter-btn').forEach(b => {
          b.classList.remove('c1ext-active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('c1ext-active');
        btn.setAttribute('aria-pressed', 'true');
        currentFilter = btn.dataset.filter;
        renderGrid();
      });
    });

    document.getElementById('c1ext-sort-toggle').addEventListener('change', e => {
      sortHighest = e.target.checked;
      renderGrid();
    });
  }

  // ── Load Handler ───────────────────────────────────────────────────
  async function handleLoadAll() {
    if (isLoading) return;
    isLoading = true;

    const session = getSessionData();
    if (!session) {
      showError(
        'Could not read session data. Please make sure you are logged in to Capital One Offers.'
      );
      isLoading = false;
      return;
    }

    const btn = document.getElementById('c1ext-load-btn');
    const progress = document.getElementById('c1ext-progress');
    const filters = document.getElementById('c1ext-filters');
    const summary = document.getElementById('c1ext-summary');
    const gridContainer = findGridContainer();
    const loadMoreBtn = findLoadMoreButton();

    // Update UI state
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading...';
    }
    if (progress) progress.removeAttribute('hidden');
    updateProgress('Starting...');

    // Capture React tile elements BEFORE hiding — map used for click delegation
    sessionData = session;
    buildReactTileMap();

    // Hide original feed elements while extension renders
    if (gridContainer) gridContainer.classList.add('c1ext-hidden');
    // Hide only the button itself (not a parent container) to avoid hiding large page sections
    if (loadMoreBtn) loadMoreBtn.classList.add('c1ext-hidden');

    try {
      allTiles = await fetchAllDeals(session, count => {
        updateProgress(`Loaded ${count} deals so far...`);
      });

      // Success state
      if (btn) {
        btn.textContent = `\u2713 All ${allTiles.length} Deals Loaded`;
        btn.disabled = true;
      }
      if (progress) progress.setAttribute('hidden', '');
      if (filters) filters.removeAttribute('hidden');
      if (summary) summary.removeAttribute('hidden');

      renderGrid();
    } catch (err) {
      // Restore original grid on error so the page stays usable
      if (gridContainer) gridContainer.classList.remove('c1ext-hidden');
      if (loadMoreBtn) loadMoreBtn.classList.remove('c1ext-hidden');

      const messages = {
        SESSION_EXPIRED: 'Session expired — please refresh the page and try again.',
        NETWORK_ERROR: 'Network error — please check your connection.',
        PARSE_ERROR: 'Unexpected API response — the page format may have changed.',
        RATE_LIMITED: 'Too many requests — please wait a moment and try again.',
      };
      showError(messages[err.message] || `Error loading deals: ${err.message}`);
    } finally {
      isLoading = false;
    }
  }

  // ── Init ───────────────────────────────────────────────────────────
  function resetState() {
    allTiles = [];
    currentFilter = 'all';
    sortHighest = false;
    isLoading = false;
    reactTileMap = new Map();
    sessionData = null;
  }

  function init() {
    // Remove any existing toolbar before re-injecting (e.g. after SPA navigation)
    const existing = document.getElementById('c1ext-toolbar');
    const existingGrid = document.getElementById('c1ext-grid');
    if (existing) existing.remove();
    if (existingGrid) existingGrid.remove();

    resetState();

    const container = findGridContainer();
    if (!container || !container.parentElement) return;

    injectToolbar(container);
  }

  // Wait for React/Remix to mount the feed tiles, with an optional timeout
  let pendingObserver = null;

  function waitAndInit() {
    // Disconnect any previous observer before starting a new one
    if (pendingObserver) {
      pendingObserver.disconnect();
      pendingObserver = null;
    }

    if (document.querySelector('[data-testid^="feed-tile-"]')) {
      init();
      return;
    }

    let timeoutId;
    const obs = new MutationObserver(() => {
      if (document.querySelector('[data-testid^="feed-tile-"]')) {
        obs.disconnect();
        pendingObserver = null;
        clearTimeout(timeoutId);
        init();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    pendingObserver = obs;

    // Safety timeout: stop observing after 15s if tiles never appear
    timeoutId = setTimeout(() => {
      obs.disconnect();
      pendingObserver = null;
    }, 15000);
  }

  // Handle Remix SPA navigation (pushState / back-forward)
  // Guard against double-patching if content script runs more than once
  if (!history.__c1extPatched) {
    history.__c1extPatched = true;
    const origPush = history.pushState.bind(history);
    history.pushState = function (...args) {
      origPush(...args);
      if (location.pathname.startsWith('/feed')) {
        waitAndInit();
      }
    };
    window.addEventListener('popstate', () => {
      if (location.pathname.startsWith('/feed')) {
        waitAndInit();
      }
    });
  }

  waitAndInit();
})();
