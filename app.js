/**
 * SalesCommand Dashboard Logic
 * Optimized for TV displays:
 * - WebP images with PNG fallback
 * - Smooth row-recycling infinite ledger
 * - Silent background sync
 * - Reduced DOM work during refresh
 * - Apps Script JSONP connection preserved
 */

// ==========================================
// CONFIGURATION
// ==========================================

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzOKOeCODt7isV51xvOOu0UbEgzxu9SsPytmCS7kBcJZzl79gLlZUNLd8B5Rc9FrfqR/exec";

const DATA_REFRESH_INTERVAL = 1 * 60 * 1000;
const SLIDESHOW_INTERVAL = 10 * 1000;

const DEFAULT_IMAGE_WEBP = "images/default-user.webp";
const DEFAULT_IMAGE_PNG = "images/default-user.png";

const EXCLUDED_AGENTS = ["diego moreira"];

const ALLOWED_STATUSES = new Set([
  "enrolled",
  "active",
  "1st cleared",
  "2nd cleared",
]);

const LEDGER_CONFIG = {
  pixelsPerSecond: 22,
  rowHeight: 66,
};

const FEATURED_LIMIT = 5;

// ==========================================
// STATE
// ==========================================

let salesData = [];
let currentSlideIndex = 0;
let slideshowTimer = null;
let dataRefreshTimer = null;

let isFirstLoad = true;
let hasLoadedDataOnce = false;
let isFetchingData = false;
let lastDataSignature = "";

let ledgerRafId = null;
let ledgerLastTimestamp = 0;
let ledgerOffset = 0;

let dom = {};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();

  updateClock();
  setInterval(updateClock, 60 * 1000);

  fetchData({ silent: false });

  if (dataRefreshTimer) clearInterval(dataRefreshTimer);

  dataRefreshTimer = setInterval(() => {
    fetchData({ silent: true });
  }, DATA_REFRESH_INTERVAL);
});

function cacheDom() {
  dom = {
    clock: document.getElementById("clock"),
    currentMonthLabel: document.getElementById("currentMonthLabel"),
    appStatus: document.getElementById("appStatus"),
    statusPill: document.getElementById("statusPill"),

    totalCompanySales: document.getElementById("totalCompanySales"),
    totalAgents: document.getElementById("totalAgents"),
    topPerformerName: document.getElementById("topPerformerName"),

    top3Grid: document.getElementById("top3Grid"),

    ledgerViewport: document.getElementById("ledgerAutoScroll"),
    ledgerTrack: document.getElementById("ledgerScrollTrack"),
    ledgerBody: document.getElementById("ledgerTableBody"),

    featuredCard: document.getElementById("featuredCardContainer"),
    featuredImg: document.getElementById("featuredImg"),
    featuredRank: document.getElementById("featuredRank"),
    featuredName: document.getElementById("featuredName"),
    featuredTeam: document.getElementById("featuredTeam"),
    featuredSales: document.getElementById("featuredSales"),
    featuredDeals: document.getElementById("featuredDeals"),
    slideshowCounter: document.getElementById("slideshowCounter"),
  };
}

// ==========================================
// CLOCK / STATUS
// ==========================================

function updateClock() {
  const now = new Date();

  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (dom.clock) {
    dom.clock.textContent = `Last Updated: ${timeStr}`;
  }

  if (dom.currentMonthLabel) {
    dom.currentMonthLabel.textContent = getCurrentMonthLabel();
  }
}

function setStatus(message, type = "ok") {
  if (dom.appStatus) {
    dom.appStatus.textContent = message;
    dom.appStatus.dataset.status = type;
  }

  if (dom.statusPill) {
    dom.statusPill.dataset.status = type;
  }
}

// ==========================================
// DATA FETCHING
// ==========================================

function fetchJSONP(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonpCallback_${Date.now()}_${Math.floor(
      Math.random() * 100000
    )}`;

    const script = document.createElement("script");
    const timeoutMs = 15000;

    let finished = false;

    function cleanup() {
      try {
        delete window[callbackName];
      } catch (err) {
        window[callbackName] = undefined;
      }

      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;
      cleanup();
      reject(new Error("JSONP request timed out"));
    }, timeoutMs);

    window[callbackName] = function (data) {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      cleanup();
      resolve(data);
    };

    script.onerror = function () {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error("JSONP request failed"));
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${callbackName}&cacheBust=${Date.now()}`;

    document.body.appendChild(script);
  });
}

async function fetchData(options = {}) {
  const { silent = false } = options;

  if (isFetchingData) return;

  isFetchingData = true;

  try {
    if (!silent || !hasLoadedDataOnce) {
      setStatus("Syncing", "loading");
    }

    const data = await fetchJSONP(APPS_SCRIPT_URL);

    if (!data || data.ok === false) {
      throw new Error(
        data && data.error ? data.error : "Invalid Apps Script response"
      );
    }

    const masterRows = Array.isArray(data.master) ? data.master : [];
    const agentRows = Array.isArray(data.agents) ? data.agents : [];

    processData(masterRows, agentRows);

    hasLoadedDataOnce = true;
    setStatus("Live", "ok");
    updateClock();
  } catch (err) {
    console.error("Error fetching Apps Script JSONP data:", err);
    setStatus("Connection Issue", "error");
  } finally {
    isFetchingData = false;
  }
}

// ==========================================
// DATA PROCESSING
// ==========================================

function getCurrentMonthLabel() {
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  const now = new Date();

  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

function processData(rawData, agentRows = []) {
  const groupedAgents = {};
  const currentMonth = getCurrentMonthLabel().toLowerCase();

  rawData.forEach((row) => {
    const rowMonth = getCell(row, ["Month", " X", "X"]).toLowerCase();

    if (rowMonth !== currentMonth) return;

    const status = getCell(row, ["Status"]).toLowerCase();

    if (!ALLOWED_STATUSES.has(status)) return;

    const name = getCell(row, ["Agent"]);

    if (!name) return;
    if (EXCLUDED_AGENTS.includes(name.toLowerCase())) return;

    const debt = parseMoney(getCell(row, ["Debt"]));
    const company = getCell(row, ["Company"]);

    if (!groupedAgents[name]) {
      groupedAgents[name] = createAgentRecord(name, company);
    }

    groupedAgents[name].totalSales += debt;
    groupedAgents[name].deals += 1;

    if (!groupedAgents[name].team && company) {
      groupedAgents[name].team = company;
    }
  });

  agentRows.forEach((row) => {
    const name = getCell(row, ["Agent", "Name"]);

    if (!name) return;
    if (EXCLUDED_AGENTS.includes(name.toLowerCase())) return;

    if (!groupedAgents[name]) {
      groupedAgents[name] = createAgentRecord(
        name,
        getCell(row, ["Company", "Team"])
      );
    }
  });

  const nextSalesData = Object.values(groupedAgents)
    .sort((a, b) => {
      if (b.totalSales !== a.totalSales) return b.totalSales - a.totalSales;
      return a.name.localeCompare(b.name);
    })
    .map((agent, index) => ({
      ...agent,
      rank: index + 1,
    }));

  const newSignature = JSON.stringify(
    nextSalesData.map((agent) => ({
      name: agent.name,
      totalSales: Math.round(agent.totalSales * 100) / 100,
      deals: agent.deals,
      team: agent.team,
      rank: agent.rank,
    }))
  );

  if (newSignature === lastDataSignature) {
    return;
  }

  lastDataSignature = newSignature;
  salesData = nextSalesData;

  if (currentSlideIndex >= Math.min(FEATURED_LIMIT, salesData.length)) {
    currentSlideIndex = 0;
  }

  preloadFeaturedImages();
  scheduleUIUpdate();

  if (isFirstLoad) {
    startSlideshow();
    isFirstLoad = false;
  }
}

function createAgentRecord(name, team = "") {
  const imagePaths = generateImagePaths(name);

  return {
    name,
    totalSales: 0,
    deals: 0,
    team: team || "",
    imagePath: imagePaths.webp,
    fallbackImagePath: imagePaths.png,
    rank: 0,
  };
}

function getCell(row, keys) {
  if (!row) return "";

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return String(row[key] ?? "").trim();
    }
  }

  return "";
}

function parseMoney(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value || "").replace(/[^0-9.-]+/g, "");
  const parsed = parseFloat(cleaned);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeImageName(fullName) {
  return String(fullName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function generateImagePaths(fullName) {
  const normalized = normalizeImageName(fullName);

  return {
    webp: `images/${normalized}.webp`,
    png: `images/${normalized}.png`,
  };
}

function preloadFeaturedImages() {
  salesData.slice(0, FEATURED_LIMIT).forEach((agent) => {
    const img = new Image();
    img.src = agent.imagePath;
  });

  const defaultWebp = new Image();
  defaultWebp.src = DEFAULT_IMAGE_WEBP;

  const defaultPng = new Image();
  defaultPng.src = DEFAULT_IMAGE_PNG;
}

// ==========================================
// IMAGE FALLBACKS
// ==========================================

function setImageSource(img, primarySrc, fallbackSrc, altText = "") {
  if (!img) return;

  img.alt = altText;

  img.dataset.primarySrc = primarySrc || "";
  img.dataset.fallbackSrc = fallbackSrc || "";
  img.dataset.fallbackTried = "";
  img.dataset.defaultWebpTried = "";
  img.dataset.defaultPngTried = "";

  if (img.getAttribute("src") !== primarySrc) {
    img.src = primarySrc;
  }
}

function handleAgentImageError(img) {
  if (!img) return;

  const fallbackSrc = img.dataset.fallbackSrc;
  const currentSrc = img.getAttribute("src") || "";

  if (
    fallbackSrc &&
    !img.dataset.fallbackTried &&
    !currentSrc.includes(fallbackSrc)
  ) {
    img.dataset.fallbackTried = "true";
    img.src = fallbackSrc;
    return;
  }

  if (
    !img.dataset.defaultWebpTried &&
    !currentSrc.includes(DEFAULT_IMAGE_WEBP)
  ) {
    img.dataset.defaultWebpTried = "true";
    img.src = DEFAULT_IMAGE_WEBP;
    return;
  }

  if (
    !img.dataset.defaultPngTried &&
    !currentSrc.includes(DEFAULT_IMAGE_PNG)
  ) {
    img.dataset.defaultPngTried = "true";
    img.src = DEFAULT_IMAGE_PNG;
  }
}

window.handleAgentImageError = handleAgentImageError;

// ==========================================
// UI UPDATES
// ==========================================

function scheduleUIUpdate() {
  requestAnimationFrame(() => {
    updateUI();
  });
}

function updateUI() {
  updateGlobalMetrics();
  updateTop3();
  updateLedger();
  renderFeaturedSlide(currentSlideIndex);
}

function updateGlobalMetrics() {
  const totalCompanySales = salesData.reduce(
    (sum, agent) => sum + agent.totalSales,
    0
  );

  if (dom.totalCompanySales) {
    dom.totalCompanySales.innerHTML = formatCurrencyLarge(totalCompanySales);
  }

  if (dom.totalAgents) {
    dom.totalAgents.textContent = salesData.length.toLocaleString();
  }

  if (dom.topPerformerName) {
    dom.topPerformerName.textContent = salesData[0]
      ? salesData[0].name
      : "No data";
  }
}

function formatCurrencyLarge(value) {
  const safeValue = Number.isFinite(value) ? value : 0;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const formatted = formatter.format(Math.floor(safeValue));
  const cents = Math.abs(safeValue % 1).toFixed(2).substring(2);

  return `${formatted}.<span>${cents}</span>`;
}

function formatCurrency(value) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safeValue);
}

// ==========================================
// TOP 3
// ==========================================

function updateTop3() {
  if (!dom.top3Grid) return;

  const top3 = salesData.slice(0, 3);

  if (!top3.length) {
    dom.top3Grid.innerHTML = `
      <div class="empty-state">
        Waiting for sales data...
      </div>
    `;
    return;
  }

  const labels = ["Elite Performer", "Global Runner-Up", "Top Closer"];

  dom.top3Grid.innerHTML = top3
    .map((agent, index) => {
      const medalClass =
        index === 0 ? "gold" : index === 1 ? "silver" : "bronze";

      return `
        <article class="top-card ${medalClass}">
          <div class="top-card-header">
            <div class="avatar-wrap small ${medalClass}">
              <img
                src="${escapeAttr(agent.imagePath)}"
                data-fallback-src="${escapeAttr(agent.fallbackImagePath)}"
                alt="${escapeAttr(agent.name)}"
                decoding="async"
                loading="eager"
                onerror="window.handleAgentImageError(this)"
              />
              <span class="rank-dot">${agent.rank}</span>
            </div>

            <span class="performance-tag">${labels[index]}</span>
          </div>

          <div class="top-card-body">
            <h4 title="${escapeAttr(agent.name)}">${escapeHtml(agent.name)}</h4>
            <p title="${escapeAttr(agent.team)}">${escapeHtml(
        agent.team || "Team"
      )}</p>
          </div>

          <div class="top-card-footer">
            <strong>${formatCurrency(agent.totalSales)}</strong>
            <span>${agent.deals} deals</span>
          </div>
        </article>
      `;
    })
    .join("");
}

// ==========================================
// LEDGER - ROW RECYCLING INFINITE LOOP
// ==========================================

function updateLedger() {
  if (!dom.ledgerBody || !dom.ledgerTrack || !dom.ledgerViewport) return;

  cancelLedgerLoop();

  if (!salesData.length) {
    dom.ledgerBody.innerHTML = `
      <tr class="ledger-row">
        <td colspan="5" class="ledger-empty">Waiting for sales data...</td>
      </tr>
    `;

    dom.ledgerTrack.style.transform = "translate3d(0, 0, 0)";
    return;
  }

  const singleRowsHTML = salesData.map(buildLedgerRow).join("");

  dom.ledgerTrack.style.transform = "translate3d(0, 0, 0)";
  dom.ledgerBody.innerHTML = singleRowsHTML;

  requestAnimationFrame(() => {
    const baseHeight = dom.ledgerBody.getBoundingClientRect().height;
    const viewportHeight = dom.ledgerViewport.clientHeight;

    if (!baseHeight || baseHeight <= 0 || !viewportHeight) return;

    let copiesNeeded = 1;

    if (baseHeight < viewportHeight * 1.8) {
      copiesNeeded = Math.ceil((viewportHeight * 2.4) / baseHeight);
    }

    copiesNeeded = Math.max(1, Math.min(copiesNeeded, 6));

    if (copiesNeeded > 1) {
      dom.ledgerBody.innerHTML = singleRowsHTML.repeat(copiesNeeded);
    }

    ledgerOffset = 0;
    ledgerLastTimestamp = 0;
    dom.ledgerTrack.style.transform = "translate3d(0, 0, 0)";

    ledgerRafId = requestAnimationFrame(animateLedgerLoop);
  });
}

function buildLedgerRow(agent) {
  const rankClass = agent.rank === 1 ? "rank-pill first" : "rank-pill";

  return `
    <tr class="ledger-row">
      <td class="rank-cell">
        <span class="${rankClass}">${agent.rank}</span>
      </td>

      <td class="rep-cell">
        <div class="rep-profile">
          <img
            src="${escapeAttr(agent.imagePath)}"
            data-fallback-src="${escapeAttr(agent.fallbackImagePath)}"
            alt="${escapeAttr(agent.name)}"
            decoding="async"
            loading="lazy"
            onerror="window.handleAgentImageError(this)"
          />
          <span title="${escapeAttr(agent.name)}">${escapeHtml(agent.name)}</span>
        </div>
      </td>

      <td class="team-cell" title="${escapeAttr(agent.team)}">
        ${escapeHtml(agent.team || "—")}
      </td>

      <td class="sales-cell">
        ${formatCurrency(agent.totalSales)}
      </td>

      <td class="deals-cell">
        ${agent.deals}
      </td>
    </tr>
  `;
}

function animateLedgerLoop(timestamp) {
  if (!dom.ledgerBody || !dom.ledgerTrack) return;

  if (!ledgerLastTimestamp) {
    ledgerLastTimestamp = timestamp;
  }

  const deltaSeconds = Math.min((timestamp - ledgerLastTimestamp) / 1000, 0.05);
  ledgerLastTimestamp = timestamp;

  ledgerOffset += LEDGER_CONFIG.pixelsPerSecond * deltaSeconds;

  recycleLedgerRows();

  dom.ledgerTrack.style.transform = `translate3d(0, ${-ledgerOffset}px, 0)`;

  ledgerRafId = requestAnimationFrame(animateLedgerLoop);
}

function recycleLedgerRows() {
  const rowHeight = LEDGER_CONFIG.rowHeight;

  if (!rowHeight || rowHeight <= 0) return;

  while (ledgerOffset >= rowHeight) {
    const firstRow = dom.ledgerBody.firstElementChild;

    if (!firstRow) return;

    dom.ledgerBody.appendChild(firstRow);
    ledgerOffset -= rowHeight;
  }
}

function cancelLedgerLoop() {
  if (ledgerRafId) {
    cancelAnimationFrame(ledgerRafId);
    ledgerRafId = null;
  }

  ledgerLastTimestamp = 0;
  ledgerOffset = 0;
}

// ==========================================
// FEATURED SLIDESHOW
// ==========================================

function startSlideshow() {
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
  }

  renderFeaturedSlide(currentSlideIndex);

  slideshowTimer = setInterval(() => {
    advanceFeaturedSlide();
  }, SLIDESHOW_INTERVAL);
}

function advanceFeaturedSlide() {
  const featuredCount = Math.min(FEATURED_LIMIT, salesData.length);

  if (!featuredCount || !dom.featuredCard) return;

  const nextIndex = (currentSlideIndex + 1) % featuredCount;
  const nextAgent = salesData[nextIndex];

  const preloader = new Image();

  preloader.onload = () => {
    switchFeaturedSlide(nextIndex);
  };

  preloader.onerror = () => {
    switchFeaturedSlide(nextIndex);
  };

  preloader.src = nextAgent.imagePath;
}

function switchFeaturedSlide(nextIndex) {
  if (!dom.featuredCard) return;

  dom.featuredCard.classList.add("is-switching");

  setTimeout(() => {
    currentSlideIndex = nextIndex;
    renderFeaturedSlide(currentSlideIndex);

    requestAnimationFrame(() => {
      dom.featuredCard.classList.remove("is-switching");
    });
  }, 320);
}

function renderFeaturedSlide(index) {
  if (!salesData[index]) return;

  const agent = salesData[index];
  const featuredCount = Math.min(FEATURED_LIMIT, salesData.length);

  if (dom.slideshowCounter) {
    dom.slideshowCounter.textContent = `${index + 1} / ${featuredCount}`;
  }

  setImageSource(
    dom.featuredImg,
    agent.imagePath,
    agent.fallbackImagePath,
    agent.name
  );

  if (dom.featuredRank) dom.featuredRank.textContent = `#${agent.rank}`;
  if (dom.featuredName) dom.featuredName.textContent = agent.name;
  if (dom.featuredTeam) dom.featuredTeam.textContent = agent.team || "Team";

  if (dom.featuredSales) {
    dom.featuredSales.textContent = formatCurrency(agent.totalSales);
  }

  if (dom.featuredDeals) {
    dom.featuredDeals.textContent = `${agent.deals} deals`;
  }
}

// ==========================================
// UTILITIES
// ==========================================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}