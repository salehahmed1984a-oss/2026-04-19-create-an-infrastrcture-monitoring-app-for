const state = {
  dashboard: null,
  selectedSiteId: null,
  siteDetails: new Map(),
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
  summaryOffline: document.querySelector("#summary-offline"),
  summaryClients: document.querySelector("#summary-clients"),
  summaryRisk: document.querySelector("#summary-risk"),
  summaryWarnings: document.querySelector("#summary-warnings"),
  summaryCritical: document.querySelector("#summary-critical"),
  historyPoints: document.querySelector("#history-points"),
  healthChart: document.querySelector("#health-chart"),
  offlineChart: document.querySelector("#offline-chart"),
  sitesGrid: document.querySelector("#sites-grid"),
  siteDetail: document.querySelector("#site-detail"),
  siteDetailTitle: document.querySelector("#site-detail-title")
};

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSummary(summary) {
  elements.summaryHealth.textContent = `${formatNumber(summary.healthScore)}%`;
  elements.summarySites.textContent = formatNumber(summary.siteCount);
  elements.summaryDevices.textContent = formatNumber(summary.deviceCount);
  elements.summaryOffline.textContent = formatNumber(summary.offlineDevices);
  elements.summaryClients.textContent = formatNumber(summary.totalClients);
  elements.summaryRisk.textContent = formatNumber(summary.utilizationRisk);
  elements.summaryWarnings.textContent = formatNumber(summary.warningAlarms);
  elements.summaryCritical.textContent = formatNumber(summary.criticalAlarms);
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
      await loadDashboard(state.dashboard.orgId, { silent: true, preserveSite: true });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error), "error");
    }
  }, interval);
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
    const topTypes = entry.site.alarms.topTypes?.length
      ? entry.site.alarms.topTypes.map((item) => `${escapeHtml(item.type)} (${item.count})`).join(", ")
      : "No open alarm types";

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
        <div class="metric-row"><span>Online</span><strong>${formatNumber(entry.site.onlineDevices)}</strong></div>
        <div class="metric-row"><span>Offline</span><strong>${formatNumber(entry.site.offlineDevices)}</strong></div>
        <div class="metric-row"><span>Clients</span><strong>${formatNumber(entry.site.totalClients)}</strong></div>
        <div class="metric-row"><span>Avg CPU</span><strong>${formatNumber(entry.site.avgCpu)}%</strong></div>
        <div class="metric-row"><span>Avg Memory</span><strong>${formatNumber(entry.site.avgMemory)}%</strong></div>
        <div class="metric-row"><span>Warnings</span><strong>${formatNumber(entry.site.alarms.warning)}</strong></div>
        <div class="metric-row"><span>Critical</span><strong>${formatNumber(entry.site.alarms.critical)}</strong></div>
      </div>
      <p class="card-note">${topTypes}</p>
    `;

    card.addEventListener("click", async () => {
      state.selectedSiteId = entry.site.id;
      renderSites(state.dashboard.sites);
      await renderSelectedSite();
    });

    elements.sitesGrid.append(card);
  }
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

async function fetchSiteDetails(siteId) {
  if (state.siteDetails.has(siteId)) {
    return state.siteDetails.get(siteId);
  }

  const response = await fetch(`/api/site?siteId=${encodeURIComponent(siteId)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load site details.");
  }

  state.siteDetails.set(siteId, payload);
  return payload;
}

async function renderSelectedSite() {
  const selected = state.dashboard?.sites?.find((entry) => entry.site.id === state.selectedSiteId);
  if (!selected) {
    elements.siteDetailTitle.textContent = "Select a site card";
    elements.siteDetail.className = "detail-empty";
    elements.siteDetail.textContent = "Site details will appear here after you load the dashboard and choose a site.";
    return;
  }

  elements.siteDetailTitle.textContent = selected.site.name;
  elements.siteDetail.className = "";
  elements.siteDetail.innerHTML = `<div class="detail-empty">Loading detailed view for ${escapeHtml(selected.site.name)}...</div>`;

  try {
    const details = await fetchSiteDetails(selected.site.id);
    const siteHistoryResponse = await fetch(`/api/history?orgId=${encodeURIComponent(state.dashboard.orgId)}&siteId=${encodeURIComponent(selected.site.id)}`);
    const siteHistoryPayload = await siteHistoryResponse.json();
    const siteHistory = siteHistoryResponse.ok ? siteHistoryPayload.points || [] : [];

    const devicesMarkup = details.devices.length
      ? `
        <table class="device-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Clients</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            ${details.devices
              .slice(0, 12)
              .map(
                (device) => `
                  <tr>
                    <td>${escapeHtml(device.name)}</td>
                    <td>${escapeHtml(device.status)}</td>
                    <td>${formatNumber(device.clients)}</td>
                    <td>${formatNumber(device.cpu)}%</td>
                    <td>${formatNumber(device.memory)}%</td>
                    <td>${escapeHtml(device.ip)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      `
      : `<p class="muted">No device statistics returned for this site.</p>`;

    const alarmsMarkup = details.alarms.length
      ? details.alarms
          .map(
            (alarm) => `
              <article class="alarm-item">
                <strong>${escapeHtml(alarm.type || "Unknown alarm")}</strong>
                <p>Severity: ${escapeHtml(alarm.severity || "n/a")} | Group: ${escapeHtml(alarm.group || "n/a")}</p>
                <p>Opened: ${formatDate(alarm.timestamp ? alarm.timestamp * 1000 : alarm.created_time)}</p>
              </article>
            `
          )
          .join("")
      : `<p class="muted">No open alarms returned for this site.</p>`;

    const topDevicesMarkup = details.topDevices.length
      ? details.topDevices
          .map(
            (device) => `
              <div class="metric-row">
                <span>${escapeHtml(device.name)}</span>
                <strong>${formatNumber(device.clients)} clients</strong>
              </div>
            `
          )
          .join("")
      : `<p class="muted">No high-load devices returned yet.</p>`;

    const errorNotes = [details.errors.devices, details.errors.alarms, details.errors.alarmCounts].filter(Boolean);
    const errorMarkup = errorNotes.length
      ? `<div class="message error">Partial data warning: ${escapeHtml(errorNotes.join(" | "))}</div>`
      : "";

    elements.siteDetail.innerHTML = `
      ${errorMarkup}
      <div class="detail-grid">
        <section class="detail-section">
          <p class="eyebrow">Operations</p>
          <h4>Device Statistics</h4>
          <div class="chip-row">
            <span class="mini-pill">Score ${formatNumber(details.site.score)}%</span>
            <span class="mini-pill">Avg CPU ${formatNumber(details.site.avgCpu)}%</span>
            <span class="mini-pill">Avg Memory ${formatNumber(details.site.avgMemory)}%</span>
          </div>
          ${devicesMarkup}
        </section>
        <section class="detail-section">
          <p class="eyebrow">Attention</p>
          <h4>Active Issues</h4>
          <div class="chip-row">
            <span class="mini-pill">Warnings ${formatNumber(details.site.alarms.warning)}</span>
            <span class="mini-pill">Critical ${formatNumber(details.site.alarms.critical)}</span>
            <span class="mini-pill">Risk ${formatNumber(details.site.utilizationRisk)}</span>
          </div>
          <div class="alarm-list">${alarmsMarkup}</div>
        </section>
      </div>
      <div class="detail-grid secondary">
        <section class="detail-section">
          <p class="eyebrow">Demand</p>
          <h4>Top Client Load Devices</h4>
          <div class="metric-list">${topDevicesMarkup}</div>
        </section>
        <section class="detail-section">
          <p class="eyebrow">Trend</p>
          <h4>Site Health History</h4>
          <svg id="site-history-chart" class="chart compact-chart" viewBox="0 0 600 220" preserveAspectRatio="none"></svg>
        </section>
      </div>
    `;

    const siteChart = document.querySelector("#site-history-chart");
    if (siteChart) {
      renderChart(siteChart, siteHistory, (point) => point.site.score, "#3bd38d", 100);
    }
  } catch (error) {
    elements.siteDetail.className = "detail-empty";
    elements.siteDetail.textContent = error instanceof Error ? error.message : String(error);
  }
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
  const { silent = false, preserveSite = false } = options;

  if (!silent) {
    clearMessage();
    showMessage("Loading Mist site inventory and monitoring data...");
  }

  const response = await fetch(`/api/dashboard?orgId=${encodeURIComponent(orgId)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load dashboard.");
  }

  state.dashboard = payload;
  state.siteDetails.clear();
  if (!preserveSite || !payload.sites.some((entry) => entry.site.id === state.selectedSiteId)) {
    state.selectedSiteId = payload.sites[0]?.site.id || null;
  }

  elements.generatedAt.textContent = `Updated ${formatDate(payload.generatedAt)}`;
  renderSummary(payload.summary);
  renderSites(payload.sites);
  await loadHistory(orgId);
  await renderSelectedSite();
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
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
});

elements.refreshInterval.addEventListener("change", () => {
  scheduleRefresh();
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
      await loadDashboard(config.defaultOrgId);
      return;
    }

    showMessage("Enter your Mist organization ID to load the monitoring dashboard.");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

boot();
