/**
 * SalesCommand Dashboard Logic
 * Fetches data from CSV, populates the UI, and manages the slideshow.
 */

// ==========================================
// CONFIGURATION
// ==========================================

// IMPORTANT: Paste your Google Drive Excel (.xlsx) direct download URL here.
// To get a direct download link from a Google Drive file, change the URL structure:
// From: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
// To: https://drive.google.com/uc?export=download&id=FILE_IDe
const AGENTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1YeplpWhNLgwGuT1Sbbz_TMkqKwggl1Kdi8JIc3_gM0w/export?format=csv&gid=605948154";
const GOOGLE_SHEETS_XLSX_URL =
  "https://docs.google.com/spreadsheets/d/1YeplpWhNLgwGuT1Sbbz_TMkqKwggl1Kdi8JIc3_gM0w/export?format=csv&gid=1195051681";
  
// Refresh interval (in milliseconds). Default: 1 minute.
const DATA_REFRESH_INTERVAL = 1 * 60 * 1000;

// Slideshow interval (in milliseconds). Default: 10 seconds.
const SLIDESHOW_INTERVAL = 10 * 1000;

// Local fallback data if URL is empty
const LOCAL_FALLBACK_XLSX = "data.csv"; // Using csv temporarily locally as fallback, but URL will use XLSX.

// ==========================================
// STATE
// ==========================================
let salesData = [];
let currentSlideIndex = 0;
let slideshowTimer = null;
let dataRefreshTimer = null;
let isFirstLoad = true;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  updateClock();
  setInterval(updateClock, 60000);

  fetchData();
  // Set up regular data fetching
  dataRefreshTimer = setInterval(fetchData, DATA_REFRESH_INTERVAL);
});

function updateClock() {
  const clock = document.getElementById("clock");
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (clock) clock.textContent = `Last Updated: ${timeStr}`;
}

// ==========================================
// DATA FETCHING & PARSING
// ==========================================
async function fetchData() {
  try {
    const [salesResponse, agentsResponse] = await Promise.all([
      fetch(GOOGLE_SHEETS_XLSX_URL + `&cacheBust=${Date.now()}`),
      fetch(AGENTS_CSV_URL + `&cacheBust=${Date.now()}`)
    ]);

    const salesText = await salesResponse.text();
    const agentsText = await agentsResponse.text();

    const salesWorkbook = XLSX.read(salesText, { type: "string" });
    const agentsWorkbook = XLSX.read(agentsText, { type: "string" });

    const salesSheetName = salesWorkbook.SheetNames[0];
    const agentsSheetName = agentsWorkbook.SheetNames[0];

    const salesRows = XLSX.utils.sheet_to_json(
      salesWorkbook.Sheets[salesSheetName],
      { defval: "" }
    );

    const agentRows = XLSX.utils.sheet_to_json(
      agentsWorkbook.Sheets[agentsSheetName],
      { defval: "" }
    );

    processData(salesRows, agentRows);
  } catch (err) {
    console.error("Error fetching or parsing CSV data:", err);

    if (isFirstLoad) {
      document.getElementById("topPerformerName").textContent = "Data Error";
    }
  }
}
function getCurrentMonthLabel() {
  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const now = new Date();

  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}
function processData(rawData, agentRows = []) {
  const allowedStatuses = ["enrolled", "active", "1st cleared", "2nd cleared"];
  const groupedAgents = {};
  const currentMonth = getCurrentMonthLabel().toLowerCase();

  rawData.forEach((row) => {
    const rowMonth = String(row["Month"] || "")
      .trim()
      .toLowerCase();

    if (rowMonth !== currentMonth) {
      return;
    }

    const status = String(row["Status"] || "")
      .trim()
      .toLowerCase();

    if (!allowedStatuses.includes(status)) {
      return;
    }

    const name = String(
      row["Full Name"] ||
      row["FullName"] ||
      row["Agent"] ||
      row["Sales Rep"] ||
      row["Representative"] ||
      "Unknown Agent"
    ).trim();

    const rawDebt = row["Debt"] || row["debt"] || 0;

    const debt =
      typeof rawDebt === "string"
        ? parseFloat(rawDebt.replace(/[^0-9.-]+/g, ""))
        : Number(rawDebt);

    if (!groupedAgents[name]) {
      groupedAgents[name] = {
        name: name,
        totalSales: 0,
        deals: 0,
        team: row["Team"] || "",
        region: row["Region"] || "",
        imagePath: generateImagePath(name),
      };
    }

    groupedAgents[name].totalSales += isNaN(debt) ? 0 : debt;
    groupedAgents[name].deals += 1;
  });

  // Agrega agentes que no vendieron
  agentRows.forEach((row) => {
    const name = String(row["Agent"] || "").trim();

    if (!name) return;

    if (!groupedAgents[name]) {
      groupedAgents[name] = {
        name: name,
        totalSales: 0,
        deals: 0,
        team: row["Team"] || "",
        region: "",
        imagePath: generateImagePath(name),
      };
    }
  });

  salesData = Object.values(groupedAgents);

  salesData.sort((a, b) => b.totalSales - a.totalSales);

  salesData.forEach((agent, index) => {
    agent.rank = index + 1;
  });

  updateUI();

  if (isFirstLoad) {
    startSlideshow();
    isFirstLoad = false;
  }
}

function generateImagePath(fullName) {
  // Convert name to lowercase, replace spaces with hyphens, remove special chars/accents
  const normalized = fullName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9 ]/g, "") // remove special chars
    .trim()
    .replace(/\s+/g, "-");
  return `images/${normalized}.png`;
}

// ==========================================
// UI UPDATES
// ==========================================
function updateUI() {
  if (salesData.length === 0) return;

  // Update Global Metrics
  const totalCompanySales = salesData.reduce(
    (sum, agent) => sum + agent.totalSales,
    0,
  );
  document.getElementById("totalCompanySales").innerHTML =
    formatCurrencyLarge(totalCompanySales);
  document.getElementById("totalAgents").textContent =
    salesData.length.toLocaleString();
  document.getElementById("topPerformerName").textContent = salesData[0].name;

  // Update Top 3 Grid
  updateTop3();

  // Update Ledger
  updateLedger();

  // Update Featured (if we need to refresh the current slide)
  renderFeaturedSlide(currentSlideIndex);
}

function formatCurrencyLarge(value) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const formatted = formatter.format(Math.floor(value));
  const cents = (value % 1).toFixed(2).substring(2);
  return `${formatted}.<span class="text-sm xs:text-base sm:text-lg md:text-xl lg:text-2xl opacity-40">${cents}</span>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ==========================================
// TOP 3 GRID
// ==========================================
function updateTop3() {
  const container = document.getElementById("top3Grid");
  container.innerHTML = "";

  const top3 = salesData.slice(0, 3);
  const badges = [
    {
      bg: "from-[#FDE047] to-[#CA8A04]",
      text: "text-on-tertiary-fixed",
      label: "Elite Performer",
      ring: "ring-primary",
    },
    {
      bg: "from-[#F1F5F9] to-[#94A3B8]",
      text: "text-inverse-on-surface",
      label: "Global Runner-Up",
      ring: "ring-secondary",
    },
    {
      bg: "from-[#FFEDD5] to-[#92400E]",
      text: "text-on-tertiary",
      label: "Top Closer",
      ring: "ring-tertiary-container/50",
    },
  ];

  top3.forEach((agent, i) => {
    const style = badges[i];

    const cardHtml = `
        <div class="glass-card rounded-lg xs:rounded-xl sm:rounded-2xl p-2 xs:p-3 sm:p-4 lg:p-5 border-t-[1px] border-white/20 transition-all flex flex-col h-full">
            <div class="flex justify-between items-start mb-2">
                <div class="relative">
                    <div class="w-10 xs:w-12 sm:w-14 h-10 xs:h-12 sm:h-14 rounded-full p-1 ring-1.5 ${style.ring} overflow-hidden bg-surface-container-highest">
                        <img alt="${agent.name}" class="w-full h-full object-cover rounded-full" src="${agent.imagePath}" onerror="this.src='images/default-user.png'"/>
                    </div>
                    <div class="absolute -bottom-0.5 -right-0.5 bg-gradient-to-br ${style.bg} w-4 xs:w-5 sm:w-5 h-4 xs:h-5 sm:h-5 rounded-full flex items-center justify-center border border-surface xs:border-2 shadow-md">
                        <span class="text-xs font-bold ${style.text}">${agent.rank}</span>
                    </div>
                </div>
            </div>
            <div class="space-y-0.5 mb-2 flex-1">
                <h4 class="text-sm xs:text-base sm:text-lg lg:text-lg font-bold leading-tight truncate" title="${agent.name}">${agent.name}</h4>
                <p class="text-xs xs:text-xs sm:text-xs lg:text-sm font-bold text-outline truncate" title="${agent.team}">${agent.team}</p>
            </div>
            <div>
                <h5 class="text-lg xs:text-xl sm:text-2xl lg:text-3xl font-bold text-white leading-none">${formatCurrency(agent.totalSales)}</h5>
            </div>
        </div>
        `;
    container.innerHTML += cardHtml;
  });
}

// ==========================================
// LEDGER
// ==========================================
function updateLedger() {
  const tbody = document.getElementById("ledgerTableBody");

  let html = "";
  salesData.forEach((agent) => {
    // Rank visual style
    let rankHtml = "";
    if (agent.rank === 1)
      rankHtml = `<div class="w-5 xs:w-6 sm:w-7 h-5 xs:h-6 sm:h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">1</div>`;
    else
      rankHtml = `<div class="w-5 xs:w-6 sm:w-7 h-5 xs:h-6 sm:h-7 rounded-full bg-surface-container-highest text-outline flex items-center justify-center font-bold text-xs">${agent.rank}</div>`;

    // Profile initals fallback logic can be done via CSS or just stick to image with onerror
    html += `
        <tr class="hover:bg-surface-bright/30 transition-colors border-b border-outline-variant/30">
            <td class="px-2 xs:px-3 sm:px-4 py-2 xs:py-2.5 sm:py-3">${rankHtml}</td>
            <td class="px-2 xs:px-3 sm:px-4 py-2 xs:py-2.5 sm:py-3">
                <div class="flex items-center gap-1.5 xs:gap-2 sm:gap-2.5">
                    <div class="w-7 xs:w-8 sm:w-9 h-7 xs:h-8 sm:h-9 rounded-full bg-surface-container-highest overflow-hidden border border-outline/30 shrink-0">
                        <img alt="${agent.name}" class="w-full h-full object-cover" src="${agent.imagePath}" onerror="this.src='images/default-user.png'"/>
                    </div>
                    <span class="font-bold text-xs xs:text-sm sm:text-base text-white truncate max-w-xs xs:max-w-sm" title="${agent.name}">${agent.name}</span>
                </div>
            </td>
            <td class="hidden sm:table-cell px-2 xs:px-3 sm:px-4 py-2 xs:py-2.5 sm:py-3 text-outline text-xs xs:text-sm sm:text-base truncate max-w-xs" title="${agent.team}">${agent.team}</td>
            <td class="px-2 xs:px-3 sm:px-4 text-right font-bold text-white text-xs xs:text-sm sm:text-base py-2 xs:py-2.5 sm:py-3">${formatCurrency(agent.totalSales)}</td>
            <td class="px-2 xs:px-3 sm:px-4 text-right font-medium py-2 xs:py-2.5 sm:py-3 ${agent.goalPct >= 100 ? "text-green-400" : "text-outline"} text-xs xs:text-sm sm:text-base">${agent.deals}</td>
        </tr>
        `;
  });
  tbody.innerHTML = html;

  // Reiniciar el scroll después de actualizar el contenido

  setTimeout(setupAutoScroll, 300);
}

let ledgerScrollInterval = null;
let ledgerScrollPauseTimeout = null;
let ledgerIsPaused = false;

const SCROLL_CONFIG = {
  speed: 1,
  stepTime: 40,
  moveTime: 2000,
  pauseTime: 3000,
};

function setupAutoScroll() {
  const ledgerContainer = document.getElementById("ledgerAutoScroll");

  if (!ledgerContainer) {
    console.error("No existe #ledgerAutoScroll");
    return;
  }

  // Matar scroll anterior para que NO se acumule
  if (ledgerScrollInterval) {
    clearInterval(ledgerScrollInterval);
    ledgerScrollInterval = null;
  }

  if (ledgerScrollPauseTimeout) {
    clearTimeout(ledgerScrollPauseTimeout);
    ledgerScrollPauseTimeout = null;
  }

  ledgerIsPaused = false;

  function move() {
    if (ledgerContainer.scrollHeight <= ledgerContainer.clientHeight) {
      return;
    }

    if (!ledgerIsPaused) {
      ledgerContainer.scrollTop += SCROLL_CONFIG.speed;

      if (
        ledgerContainer.scrollTop >=
        ledgerContainer.scrollHeight - ledgerContainer.clientHeight
      ) {
        ledgerContainer.scrollTop = 0;
      }
    }
  }

  function cycle() {
    ledgerIsPaused = false;

    ledgerScrollPauseTimeout = setTimeout(() => {
      ledgerIsPaused = true;

      ledgerScrollPauseTimeout = setTimeout(() => {
        cycle();
      }, SCROLL_CONFIG.pauseTime);
    }, SCROLL_CONFIG.moveTime);
  }

  ledgerScrollInterval = setInterval(move, SCROLL_CONFIG.stepTime);
  cycle();

  ledgerContainer.onmouseenter = () => {
    ledgerIsPaused = true;
  };

  ledgerContainer.onmouseleave = () => {
    ledgerIsPaused = false;
  };
}

// ==========================================
// SLIDESHOW
// ==========================================
function startSlideshow() {
  renderFeaturedSlide(currentSlideIndex);

  slideshowTimer = setInterval(() => {
    // Trigger exit animation
    const card = document.getElementById("featuredCardContainer");
    card.classList.remove("slideshow-enter-active");
    card.classList.add("slideshow-exit-active");

    setTimeout(() => {
      currentSlideIndex =
        (currentSlideIndex + 1) % Math.min(5, salesData.length);
      renderFeaturedSlide(currentSlideIndex);

      // Trigger enter animation
      card.classList.remove("slideshow-exit-active");
      card.classList.add("slideshow-enter-active");
    }, 100); // Wait for exit animation
  }, SLIDESHOW_INTERVAL);
}

function renderFeaturedSlide(index) {
  if (!salesData[index]) return;
  const agent = salesData[index];
  const featuredCount = Math.min(5, salesData.length);
  const featuredRegion = document.getElementById("featuredRegion");
  if (featuredRegion) {
    featuredRegion.textContent = agent.region;

    document.getElementById("slideshowCounter").textContent =
      `${index + 1} / ${featuredCount}`;
    document.getElementById("featuredImg").src = agent.imagePath;
    document.getElementById("featuredRank").textContent = `#${agent.rank}`;
    document.getElementById("featuredName").textContent = agent.name;
    document.getElementById("featuredTeam").textContent = agent.team;
    document.getElementById("featuredSales").textContent = formatCurrency(
      agent.totalSales,
    );

    document.getElementById("featuredGoalPctText").textContent =
      `${agent.goalPct}%`;

    // Animate progress bar
    const bar = document.getElementById("featuredGoalBar");
    bar.style.width = "0%";
    setTimeout(() => {
      bar.style.width = `${Math.min(agent.goalPct, 100)}%`;
      if (agent.goalPct >= 100) {
        bar.className =
          "h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-1000";
      } else {
        bar.className =
          "h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000";
      }
    }, 100);
  }
}
