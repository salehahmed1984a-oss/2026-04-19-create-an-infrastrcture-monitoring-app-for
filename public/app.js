const state = {
  dashboard: null,
  selectedSiteId: null,
  selectedDeviceId: null,
  history: [],
  refreshTimer: null
};

const elements = {
  configForm: document.querySelector("#config-form"),
  orgIdInput: document.querySelector("#org-id"),
  configHint: document.querySelector("#config-hint"),
  message: document.querySelector("#message"),
  generatedAt: document.querySelector("#generated-at"),
  refreshInterval: document.querySelector("#refresh-interval"),
  refreshStatus: document.querySelector("#refresh-status"),
  summaryHealth: document.querySelector("#summary-health"),
  summarySites: document.querySelector("#summary-sites"),
  summaryDevices: document.querySelector("#summary-devices"),
  summaryAps: document.querySelector("#summary-aps"),
  summarySwitches: document.querySelector("#summary-switches"),
  summaryOffline: document.querySelector("#summary-offline"),
  summaryClients: document.querySelector("#summary-clients"),
  summaryRisk: document.querySelector("#summary-risk"),
  historyPoints: document.querySelector("#history-points"),
  healthChart: document.querySelector("#health-chart"),
  offlineChart: document.querySelector("#offline-chart"),
  sitesGrid: document.querySelector("#sites-grid"),
  dashboardView: document.querySelector("#dashboard-view"),
  siteView: document.querySelector("#site-view"),
  deviceView: document.querySelector("#device-view"),
  siteDetail: document.querySelector("#site-detail"),
  siteDetailTitle: document.querySelector("#site-detail-title"),
  deviceDetail: document.querySelector("#device-detail"),
  deviceDetailTitle: document.querySelector("#device-detail-title"),
  backToDashboard: document.querySelector("#back-to-dashboard"),
  backToSite: document.querySelector("#back-to-site")
};

function getRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    orgId: params.get("orgId") || "",
    siteId: params.get("siteId") || "",
    deviceId: params.get("deviceId") || ""
  };
}

function setRoute(route, replace = false) {
  const params = new URLSearchParams();
  if (route.orgId) {
    params.set("orgId", route.orgId);
  }
  if (route.siteId) {
    params.set("siteId", route.siteId);
  }
  if (route.deviceId) {
    params.set("deviceId", route.deviceId);
  }
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  if (replace) {
    window.history.replaceState({}, "", nextUrl);
  } else {
    window.history.pushState({}, "", nextUrl);
  }
}

function renderRouteView() {
  const route = getRoute();
  const showDashboard = !route.siteId;
  const showSite = Boolean(route.siteId) && !route.deviceId;
  const showDevice = Boolean(route.siteId && route.deviceId);

  elements.dashboardView.classList.toggle("hidden", !showDashboard);
  elements.siteView.classList.toggle("hidden", !showSite);
  elements.deviceView.classList.toggle("hidden", !showDevice);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 1000000000
    ? new Date(numeric > 1000000000000 ? numeric : numeric * 1000)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showMessage(message, type = "info") {
  elements.message.textContent = message;
  elements.message.classList.remove("hidden", "error");
  if (type === "error") {
    elements.message.classList.add("error");
  }
}

function clearMessage() {
  elements.message.classList.add("hidden");
  elements.message.textContent = "";
  elements.message.classList.remove("error");
}

function healthClass(health) {
  const normalized = String(health || "").toLowerCase();
  if (normalized === "critical") {
    return "critical";
  }
  if (normalized === "degraded") {
    return "degraded";
  }
  return "healthy";
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("connected") || normalized.includes("online")) {
    return "healthy";
  }
  if (normalized.includes("warn") || normalized.includes("degrad")) {
    return "degraded";
  }
  return "critical";
}

function renderSummary(summary) {
  elements.summaryHealth.textContent = `${formatNumber(summary.healthScore)}%`;
  elements.summarySites.textContent = formatNumber(summary.siteCount);
  elements.summaryDevices.textContent = formatNumber(summary.deviceCount);
  elements.summaryAps.textContent = formatNumber(summary.apCount);
  elements.summarySwitches.textContent = formatNumber(summary.switchCount);
  elements.summaryOffline.textContent = formatNumber(summary.offlineDevices);
  elements.summaryClients.textContent = formatNumber(summary.totalClients);
  elements.summaryRisk.textContent = formatNumber(summary.riskFlags);
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  const interval = Number(elements.refreshInterval.value || 0);
  if (!interval) {
    elements.refreshStatus.textContent = "Manual";
    return;
  }

  elements.refreshStatus.textContent = `Every ${Math.round(interval / 1000)}s`;
  state.refreshTimer = setInterval(async () => {
    if (!state.dashboard?.orgId) {
      return;
    }

    try {
      await loadDashboard(state.dashboard.orgId, { silent: true, preserveSelection: true });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }
  }, interval);
}

function buildTrendPath(points, valueAccessor, maxValueOverride = null) {
  if (!points.length) {
    return "";
  }

  const values = points.map(valueAccessor);
  const maxValue = maxValueOverride ?? Math.max(...values, 1);
  const width = 600;
  const height = 220;
  const padding = 18;

  return values
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
      const y = height - padding - (Number(value || 0) * (height - padding * 2)) / Math.max(maxValue, 1);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function renderChart(svgElement, points, valueAccessor, stroke, maxValueOverride = null) {
  if (!points.length) {
    svgElement.innerHTML = `<text x="20" y="40" fill="#98adbd">History builds as the dashboard refreshes.</text>`;
    return;
  }

  const path = buildTrendPath(points, valueAccessor, maxValueOverride);
  svgElement.innerHTML = `
    <rect x="0" y="0" width="600" height="220" rx="18" fill="rgba(255,255,255,0.02)"></rect>
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
  `;
}

async function loadHistory(orgId) {
  const response = await fetch(`/api/history?orgId=${encodeURIComponent(orgId)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load history.");
  }

  state.history = payload.points || [];
  elements.historyPoints.textContent = `${state.history.length} snapshot${state.history.length === 1 ? "" : "s"}`;
  renderChart(elements.healthChart, state.history, (point) => point.summary.healthScore, "#74d8ff", 100);
  renderChart(elements.offlineChart, state.history, (point) => point.summary.offlineDevices, "#ff6d6d");
}

function renderSites(sites) {
  elements.sitesGrid.innerHTML = "";

  for (const entry of sites) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "site-card";
    if (entry.site.id === state.selectedSiteId) {
      card.classList.add("active");
    }

    const badgeClass = healthClass(entry.site.health);
    card.innerHTML = `
      <div class="site-card-header">
        <p class="eyebrow">Health Score</p>
        <span class="health-pill ${badgeClass}">${escapeHtml(entry.site.health)}</span>
      </div>
      <h4>${escapeHtml(entry.site.name)}</h4>
      <div class="score-bar">
        <span style="width: ${entry.site.score}%"></span>
      </div>
      <div class="metric-list">
        <div class="metric-row"><span>Devices</span><strong>${formatNumber(entry.site.deviceCount)}</strong></div>
        <div class="metric-row"><span>APs</span><strong>${formatNumber(entry.site.apCount)}</strong></div>
        <div class="metric-row"><span>Switches</span><strong>${formatNumber(entry.site.switchCount)}</strong></div>
        <div class="metric-row"><span>Offline</span><strong>${formatNumber(entry.site.offlineDevices)}</strong></div>
        <div class="metric-row"><span>Clients</span><strong>${formatNumber(entry.site.totalClients)}</strong></div>
        <div class="metric-row"><span>Risk</span><strong>${formatNumber(entry.site.riskFlags)}</strong></div>
      </div>
    `;

    card.addEventListener("click", async () => {
      state.selectedSiteId = entry.site.id;
      state.selectedDeviceId = entry.accessPoints[0]?.id || entry.switches[0]?.id || null;
      setRoute({ orgId: state.dashboard.orgId, siteId: state.selectedSiteId });
      renderSites(state.dashboard.sites);
      renderRouteView();
      renderSelectedSite();
    });

    elements.sitesGrid.append(card);
  }
}

function renderRecommendationCards(recommendations) {
  if (!recommendations.length) {
    return `<div class="empty-callout">No immediate attention items from the current snapshot.</div>`;
  }

  return recommendations
    .map((item) => `<article class="analysis-card">${escapeHtml(item)}</article>`)
    .join("");
}

function renderDeviceRows(devices) {
  if (!devices.length) {
    return `<div class="empty-callout">No devices returned in this category.</div>`;
  }

  return devices
    .map((device) => {
      const selected = device.id === state.selectedDeviceId ? "active" : "";
      const typeLabel = device.type === "switch" ? "Switch" : "AP";
      const statusTone = statusClass(device.status);

      return `
        <button type="button" class="device-row ${selected}" data-device-id="${escapeHtml(device.id)}">
          <div>
            <strong>${escapeHtml(device.name)}</strong>
            <p>${escapeHtml(typeLabel)} | ${escapeHtml(device.model)} | ${escapeHtml(device.version || "unknown version")}</p>
          </div>
          <div class="device-row-right">
            <span class="health-pill ${statusTone}">${escapeHtml(device.status || "unknown")}</span>
            <span class="mini-pill">${formatNumber(device.clients || 0)} clients</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function attachDeviceRowHandlers() {
  document.querySelectorAll("[data-device-id]").forEach((element) => {
    element.addEventListener("click", async () => {
      state.selectedDeviceId = element.getAttribute("data-device-id");
      setRoute({ orgId: state.dashboard.orgId, siteId: state.selectedSiteId, deviceId: state.selectedDeviceId });
      renderSelectedSite();
      renderRouteView();
      await renderSelectedDevice();
    });
  });
}

function renderSelectedSite() {
  const selected = state.dashboard?.sites?.find((entry) => entry.site.id === state.selectedSiteId);
  if (!selected) {
    elements.siteDetailTitle.textContent = "Select a site card";
    elements.siteDetail.className = "detail-empty";
    elements.siteDetail.textContent = "Site recommendations, APs, and switches will appear here after you choose a site.";
    return;
  }

  elements.siteDetailTitle.textContent = selected.site.name;
  elements.siteDetail.className = "";

  const topDevicesMarkup = selected.topDevices.length
    ? selected.topDevices.map((device) => `
      <div class="metric-row">
        <span>${escapeHtml(device.name)}</span>
        <strong>${formatNumber(device.clients)} clients</strong>
      </div>
    `).join("")
    : `<div class="empty-callout">No client load data returned yet.</div>`;

  const errorNotes = Object.values(selected.errors).filter(Boolean);
  const errorMarkup = errorNotes.length
    ? `<div class="message error">Partial data warning: ${escapeHtml(errorNotes.join(" | "))}</div>`
    : "";

  elements.siteDetail.innerHTML = `
    ${errorMarkup}
    <div class="detail-grid">
      <section class="detail-section">
        <p class="eyebrow">Attention Queue</p>
        <h4>Current Recommendations</h4>
        <div class="analysis-grid">${renderRecommendationCards(selected.recommendations)}</div>
      </section>
      <section class="detail-section">
        <p class="eyebrow">Demand</p>
        <h4>Top Loaded Devices</h4>
        <div class="metric-list">${topDevicesMarkup}</div>
      </section>
    </div>
    <div class="detail-grid secondary">
      <section class="detail-section">
        <p class="eyebrow">Wireless</p>
        <h4>Access Points</h4>
        <div class="device-list">${renderDeviceRows(selected.accessPoints)}</div>
      </section>
      <section class="detail-section">
        <p class="eyebrow">Wired</p>
        <h4>Switches</h4>
        <div class="device-list">${renderDeviceRows(selected.switches)}</div>
      </section>
    </div>
  `;

  attachDeviceRowHandlers();
}

function renderHistorySummaryChart(points) {
  const svgId = "device-history-chart";
  const markup = `<svg id="${svgId}" class="chart compact-chart" viewBox="0 0 600 220" preserveAspectRatio="none"></svg>`;
  setTimeout(() => {
    const svg = document.querySelector(`#${svgId}`);
    if (svg) {
      renderChart(svg, points, (point) => point.device.clients || 0, "#3bd38d");
    }
  }, 0);
  return markup;
}

async function renderSelectedDevice() {
  const site = state.dashboard?.sites?.find((entry) => entry.site.id === state.selectedSiteId);
  const localDevice = site ? [...site.accessPoints, ...site.switches].find((device) => device.id === state.selectedDeviceId) : null;

  if (!site || !localDevice) {
    elements.deviceDetailTitle.textContent = "Select an AP or switch";
    elements.deviceDetail.className = "detail-empty";
    elements.deviceDetail.textContent = "Click an AP or switch row to open interactive device diagnostics.";
    return;
  }

  elements.deviceDetailTitle.textContent = localDevice.name;
  elements.deviceDetail.className = "";
  elements.deviceDetail.innerHTML = `<div class="detail-empty">Loading device diagnostics for ${escapeHtml(localDevice.name)}...</div>`;

  const response = await fetch(
    `/api/device?orgId=${encodeURIComponent(state.dashboard.orgId)}&siteId=${encodeURIComponent(site.site.id)}&deviceId=${encodeURIComponent(localDevice.id)}`
  );
  const payload = await response.json();

  if (!response.ok) {
    elements.deviceDetail.className = "detail-empty";
    elements.deviceDetail.textContent = payload.error || "Failed to load device details.";
    return;
  }

  const device = payload.device;
  const history = payload.history || [];
  const observationsMarkup = device.insights.observations.length
    ? device.insights.observations.map((item) => `<div class="analysis-card subtle">${escapeHtml(item)}</div>`).join("")
    : `<div class="empty-callout">No extra observations from the current snapshot.</div>`;

  const recommendationsMarkup = device.insights.recommendations.length
    ? device.insights.recommendations.map((item) => `<div class="analysis-card">${escapeHtml(item)}</div>`).join("")
    : `<div class="empty-callout">No recommendations right now.</div>`;

  const firmwareMarkup = `
    <div class="metric-row"><span>Current Version</span><strong>${escapeHtml(device.insights.firmware.currentVersion || "unknown")}</strong></div>
    <div class="metric-row"><span>Newest Seen Same Model</span><strong>${escapeHtml(device.insights.firmware.newestSeenVersion || "n/a")}</strong></div>
    <div class="metric-row"><span>Review Recommended</span><strong>${device.insights.firmware.reviewRecommended ? "Yes" : "No"}</strong></div>
  `;

  const typeSpecificMarkup = device.type === "switch"
    ? `
      <div class="metric-row"><span>PoE Draw</span><strong>${escapeHtml(device.power?.power_draw ?? "n/a")} W</strong></div>
      <div class="metric-row"><span>PoE Reserved</span><strong>${escapeHtml(device.power?.power_reserved ?? "n/a")} W</strong></div>
      <div class="metric-row"><span>PoE Max</span><strong>${escapeHtml(device.power?.max_power ?? "n/a")} W</strong></div>
      <div class="metric-row"><span>Ports Up</span><strong>${formatNumber(device.portSummary?.upPorts || 0)}</strong></div>
      <div class="metric-row"><span>Ports Down</span><strong>${formatNumber(device.portSummary?.downPorts || 0)}</strong></div>
      <div class="metric-row"><span>Max Temperature</span><strong>${escapeHtml(device.maxTemperature ?? "n/a")} °C</strong></div>
      <div class="metric-row"><span>Pending Version</span><strong>${escapeHtml(device.pendingVersion || "none")}</strong></div>
    `
    : `
      <div class="metric-row"><span>2.4 GHz Power</span><strong>${escapeHtml(device.txPower24 ?? "n/a")} dBm</strong></div>
      <div class="metric-row"><span>5 GHz Power</span><strong>${escapeHtml(device.txPower5 ?? "n/a")} dBm</strong></div>
      <div class="metric-row"><span>2.4 Radio Disabled</span><strong>${device.tx24Disabled ? "Yes" : "No"}</strong></div>
      <div class="metric-row"><span>5 Radio Disabled</span><strong>${device.tx5Disabled ? "Yes" : "No"}</strong></div>
      <div class="metric-row"><span>Mesh Role</span><strong>${escapeHtml(device.meshRole || "none")}</strong></div>
    `;

  const busiestPortsMarkup = device.type === "switch" && device.portSummary?.busiest?.length
    ? device.portSummary.busiest.map((port) => `
      <div class="metric-row">
        <span>${escapeHtml(port.name)}</span>
        <strong>${port.up ? "up" : "down"} | ${formatNumber(port.rxPkts + port.txPkts)} packets</strong>
      </div>
    `).join("")
    : `<div class="empty-callout">No switch port activity summary for this device.</div>`;

  elements.deviceDetail.innerHTML = `
    <div class="detail-grid">
      <section class="detail-section">
        <p class="eyebrow">Current State</p>
        <h4>${escapeHtml(device.type === "switch" ? "Switch diagnostics" : "Access point diagnostics")}</h4>
        <div class="chip-row">
          <span class="mini-pill">${escapeHtml(device.status || "unknown")}</span>
          <span class="mini-pill">${formatNumber(device.clients || 0)} clients</span>
          <span class="mini-pill">CPU ${formatNumber(device.cpu || 0)}%</span>
          <span class="mini-pill">Memory ${formatNumber(device.memory || 0)}%</span>
        </div>
        <div class="metric-list">
          <div class="metric-row"><span>Model</span><strong>${escapeHtml(device.model)}</strong></div>
          <div class="metric-row"><span>IP</span><strong>${escapeHtml(device.ip || "n/a")}</strong></div>
          <div class="metric-row"><span>Last Seen</span><strong>${formatDate(device.lastSeen)}</strong></div>
          <div class="metric-row"><span>Uptime</span><strong>${formatNumber(device.uptime || 0)} sec</strong></div>
          ${typeSpecificMarkup}
        </div>
      </section>
      <section class="detail-section">
        <p class="eyebrow">Firmware</p>
        <h4>Upgrade Review</h4>
        <div class="metric-list">${firmwareMarkup}</div>
        <div class="analysis-grid top-space">${recommendationsMarkup}</div>
      </section>
    </div>
    <div class="detail-grid secondary">
      <section class="detail-section">
        <p class="eyebrow">Observations</p>
        <h4>What Changed Or Stands Out</h4>
        <div class="analysis-grid">${observationsMarkup}</div>
        ${device.type === "switch" ? `<div class="metric-list top-space">${busiestPortsMarkup}</div>` : ""}
      </section>
      <section class="detail-section">
        <p class="eyebrow">History</p>
        <h4>Recent Device Trend</h4>
        ${renderHistorySummaryChart(history)}
      </section>
    </div>
    <section class="detail-section top-space">
      <p class="eyebrow">Diagnostics</p>
      <h4>Raw Device Payload</h4>
      <details>
        <summary>Open raw JSON</summary>
        <pre class="raw-json">${escapeHtml(JSON.stringify(device.raw, null, 2))}</pre>
      </details>
    </section>
  `;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  if (config.defaultOrgId) {
    elements.orgIdInput.value = config.defaultOrgId;
  }
  elements.configHint.textContent = config.hasToken
    ? `Using ${config.apiBaseUrl} with a server-side token from ${config.envFileLoaded || "environment"}.`
    : "Set MIST_API_TOKEN before starting the server.";
  return config;
}

async function loadDashboard(orgId, options = {}) {
  const { silent = false, preserveSelection = false } = options;

  if (!silent) {
    clearMessage();
    showMessage("Loading Mist infrastructure inventory, AP telemetry, switch telemetry, and recommendations...");
  }

  const response = await fetch(`/api/dashboard?orgId=${encodeURIComponent(orgId)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load dashboard.");
  }

  state.dashboard = payload;
  const route = getRoute();
  if (!preserveSelection || !payload.sites.some((entry) => entry.site.id === state.selectedSiteId)) {
    state.selectedSiteId = route.siteId && payload.sites.some((entry) => entry.site.id === route.siteId)
      ? route.siteId
      : payload.sites[0]?.site.id || null;
  }

  const selectedSite = payload.sites.find((entry) => entry.site.id === state.selectedSiteId);
  const selectedDeviceStillExists = selectedSite && [...selectedSite.accessPoints, ...selectedSite.switches].some((device) => device.id === state.selectedDeviceId);
  if (!preserveSelection || !selectedDeviceStillExists) {
    state.selectedDeviceId = route.deviceId && selectedSite && [...selectedSite.accessPoints, ...selectedSite.switches].some((device) => device.id === route.deviceId)
      ? route.deviceId
      : selectedSite?.accessPoints[0]?.id || selectedSite?.switches[0]?.id || null;
  }

  elements.generatedAt.textContent = `Updated ${formatDate(payload.generatedAt)}`;
  renderSummary(payload.summary);
  renderSites(payload.sites);
  await loadHistory(orgId);
  renderRouteView();
  if (getRoute().siteId) {
    renderSelectedSite();
  }
  if (getRoute().deviceId) {
    await renderSelectedDevice();
  }

  if (!silent) {
    clearMessage();
  }
}

elements.configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const orgId = elements.orgIdInput.value.trim();
  if (!orgId) {
    showMessage("Enter your Mist organization ID first.", "error");
    return;
  }

  try {
    await loadDashboard(orgId);
    setRoute({ orgId }, true);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
});

elements.refreshInterval.addEventListener("change", () => {
  scheduleRefresh();
});

elements.backToDashboard.addEventListener("click", () => {
  state.selectedDeviceId = null;
  setRoute({ orgId: state.dashboard?.orgId || "" });
  renderRouteView();
});

elements.backToSite.addEventListener("click", () => {
  setRoute({ orgId: state.dashboard?.orgId || "", siteId: state.selectedSiteId || "" });
  renderRouteView();
  renderSelectedSite();
});

window.addEventListener("popstate", async () => {
  renderRouteView();
  if (state.dashboard) {
    const route = getRoute();
    state.selectedSiteId = route.siteId || state.selectedSiteId;
    state.selectedDeviceId = route.deviceId || null;
    if (route.siteId) {
      renderSelectedSite();
    }
    if (route.deviceId) {
      await renderSelectedDevice();
    }
  }
});

async function boot() {
  try {
    const config = await loadConfig();
    scheduleRefresh();

    if (!config.hasToken) {
      showMessage("Set MIST_API_TOKEN in your environment, then restart the server.", "error");
      return;
    }

    if (config.defaultOrgId) {
      const route = getRoute();
      await loadDashboard(route.orgId || config.defaultOrgId);
      return;
    }

    showMessage("Enter your Mist organization ID to load the monitoring dashboard.");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

boot();
