const state = {
  dashboard: null,
  selectedSiteId: null,
  selectedDeviceId: null,
  history: [],
  selectedTrend: null,
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
  trendView: document.querySelector("#trend-view"),
  deviceView: document.querySelector("#device-view"),
  siteDetail: document.querySelector("#site-detail"),
  siteDetailTitle: document.querySelector("#site-detail-title"),
  trendDetail: document.querySelector("#trend-detail"),
  trendDetailTitle: document.querySelector("#trend-detail-title"),
  deviceDetail: document.querySelector("#device-detail"),
  deviceDetailTitle: document.querySelector("#device-detail-title"),
  backToDashboard: document.querySelector("#back-to-dashboard"),
  backToDashboardFromTrend: document.querySelector("#back-to-dashboard-from-trend"),
  backToSite: document.querySelector("#back-to-site")
};

function getRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    orgId: params.get("orgId") || "",
    siteId: params.get("siteId") || "",
    deviceId: params.get("deviceId") || "",
    trend: params.get("trend") || ""
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
  if (route.trend) {
    params.set("trend", route.trend);
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
  const showDashboard = !route.siteId && !route.deviceId && !route.trend;
  const showSite = Boolean(route.siteId) && !route.deviceId;
  const showTrend = Boolean(route.trend) && !route.siteId && !route.deviceId;
  const showDevice = Boolean(route.siteId && route.deviceId);

  elements.dashboardView.classList.toggle("hidden", !showDashboard);
  elements.siteView.classList.toggle("hidden", !showSite);
  elements.trendView.classList.toggle("hidden", !showTrend);
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

function renderScoreBreakdown(site) {
  const items = [
    { label: "Current score", value: `${formatNumber(site.score)}%` },
    { label: "Warning alarms", value: formatNumber(site.alarms?.warning || 0) },
    { label: "Critical alarms", value: formatNumber(site.alarms?.critical || 0) },
    { label: "Risk flags", value: formatNumber(site.riskFlags || 0) },
    { label: "Offline devices", value: formatNumber(site.offlineDevices || 0) }
  ];

  const penalties = Array.isArray(site.scoreBreakdown) ? site.scoreBreakdown : [];
  const penaltyMarkup = penalties.length
    ? penalties.map((item) => `
      <div class="breakdown-card">
        <span class="breakdown-label">${escapeHtml(item.label)}</span>
        <strong>-${formatNumber(item.amount)}</strong>
      </div>
    `).join("")
    : `
      <div class="breakdown-card">
        <span class="breakdown-label">No deductions</span>
        <strong>100%</strong>
      </div>
    `;

  const metricMarkup = items.map((item) => `
    <div class="breakdown-card">
      <span class="breakdown-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join("");

  return `
    <div class="breakdown-grid">${metricMarkup}</div>
    <div class="breakdown-grid top-space">${penaltyMarkup}</div>
  `;
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

function openTrend(trend) {
  state.selectedTrend = trend;
  setRoute({ orgId: state.dashboard?.orgId || "", trend });
  renderRouteView();
  renderTrendDetail();
}

function attachTrendHandlers() {
  document.querySelectorAll("[data-trend]").forEach((element) => {
    element.addEventListener("click", () => {
      openTrend(element.getAttribute("data-trend"));
    });
  });
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
  attachTrendHandlers();
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

function renderConfigCards(items) {
  if (!items.length) {
    return `<div class="empty-callout">No immediate configuration changes are suggested from this snapshot.</div>`;
  }

  return items
    .map((item) => {
      const guide = buildRecommendationGuide(item);
      return `
        <article class="analysis-card config">
          <strong>${escapeHtml(guide.title)}</strong>
          <p>${escapeHtml(guide.summary)}</p>
          <ol class="guide-list">
            ${guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
          </ol>
        </article>
      `;
    })
    .join("");
}

function buildRecommendationGuide(item) {
  const text = String(item || "");
  const lower = text.toLowerCase();

  if (lower.includes("6 ghz")) {
    return {
      title: "Enable 6 GHz Readiness",
      summary: text,
      steps: [
        "In Mist, open Organization or Site and go to WLANs.",
        "Select the secure SSID you want clients to use.",
        "Change security to WPA3-Enterprise, WPA3-Personal, or OWE Transition as appropriate.",
        "Explicitly enable the 6 GHz band on that WLAN.",
        "Apply the WLAN to 6 GHz-capable APs first and validate onboarding with a small pilot group."
      ]
    };
  }

  if (lower.includes("wpa3") || lower.includes("owe")) {
    return {
      title: "Strengthen WLAN Security",
      summary: text,
      steps: [
        "In Mist, open the WLAN configuration for the SSID.",
        "Review the current security type and client compatibility requirements.",
        "Move secure SSIDs toward WPA3-Enterprise where managed devices support it.",
        "For guest access, use OWE Transition if you want modern encrypted guest access with 6 GHz support.",
        "Test a sample of clients before rolling the change out site-wide."
      ]
    };
  }

  if (lower.includes("2.4 ghz") || lower.includes("transmit power") || lower.includes("radio power")) {
    return {
      title: "Tune AP Radio Power",
      summary: text,
      steps: [
        "In Mist, open the Site or AP configuration and review radio settings.",
        "Check the current 2.4 GHz minimum and maximum transmit power values.",
        "Reduce 2.4 GHz power gradually instead of making a large jump all at once.",
        "Validate roaming, retry rate, and sticky-client behavior after the change.",
        "Keep 5 GHz and 6 GHz as the preferred bands for capable clients."
      ]
    };
  }

  if (lower.includes("client distribution") || lower.includes("ap capacity")) {
    return {
      title: "Improve Client Distribution",
      summary: text,
      steps: [
        "Check which APs are carrying the highest client counts in the dashboard.",
        "Review transmit power and neighboring AP placement for the overloaded area.",
        "Lower power on sticky-client APs or add another AP if coverage overlap is weak.",
        "Re-check roaming and throughput behavior after the change.",
        "Keep a short before/after note so you can compare whether the adjustment helped."
      ]
    };
  }

  if (lower.includes("poe")) {
    return {
      title: "Review Switch PoE Budget",
      summary: text,
      steps: [
        "Open the switch detail in Mist and review current PoE draw and reserved budget.",
        "Identify powered endpoints such as APs, phones, or cameras on that switch.",
        "Check whether all attached devices need full allocated power or could use a different profile.",
        "Plan additional power headroom before adding more powered devices.",
        "If needed, redistribute powered devices across switches or upgrade switch power capacity."
      ]
    };
  }

  if (lower.includes("unused") || lower.includes("ports are down") || lower.includes("port profiles")) {
    return {
      title: "Harden Unused Switch Ports",
      summary: text,
      steps: [
        "In Mist, open Switch Configuration or the relevant switch template.",
        "Review port profiles assigned to access, AP, uplink, and unused ports.",
        "Apply disabled or restricted profiles to ports that are not in use.",
        "Make sure AP and uplink ports use explicit profiles rather than generic defaults.",
        "Document which ports are intentionally spare so future changes stay consistent."
      ]
    };
  }

  if (lower.includes("802.1x") || lower.includes("mab") || lower.includes("eap-tls")) {
    return {
      title: "Improve Access Control",
      summary: text,
      steps: [
        "List which wired and wireless device groups support 802.1X today.",
        "Use 802.1X first for managed users and devices, ideally with certificate-based EAP-TLS.",
        "Reserve MAB for exceptions like IoT or legacy devices that cannot do 802.1X.",
        "Apply the policy consistently across switch and WLAN access workflows.",
        "Pilot on one site or device group before broader rollout."
      ]
    };
  }

  if (lower.includes("firmware")) {
    return {
      title: "Plan Firmware Alignment",
      summary: text,
      steps: [
        "Review the device or model versions shown in the dashboard.",
        "Confirm the target firmware version you want across that model family.",
        "Check maintenance window availability and client impact.",
        "Schedule the upgrade in Mist for a low-risk period.",
        "Verify connectivity, alarms, and client performance after the upgrade."
      ]
    };
  }

  return {
    title: "Recommended Change",
    summary: text,
    steps: [
      "Open the relevant site, AP, switch, or WLAN settings in Mist.",
      "Review the current configuration related to this recommendation.",
      "Apply the change to a small pilot area first if the impact is uncertain.",
      "Monitor clients, alarms, and device health after the change.",
      "Roll the change out more broadly once the result looks good."
    ]
  };
}

function renderAuditCards(items) {
  if (!items.length) {
    return `<div class="empty-callout">No security or 6 GHz audit findings yet.</div>`;
  }

  return items
    .map((item) => `<article class="analysis-card ${escapeHtml(item.severity)}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`)
    .join("");
}

function renderAlarmFindings(items) {
  if (!items.length) {
    return `<div class="empty-callout">No open alarm details were returned for this site at the moment.</div>`;
  }

  return items
    .map((item) => `
      <article class="analysis-card ${escapeHtml(item.severity === "warning" ? "watch" : item.severity)}">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(`${item.count} open ${item.severity} alarm${item.count === 1 ? "" : "s"}`)}</p>
        ${item.examples?.length ? `<p>Affected: ${escapeHtml(item.examples.join(", "))}</p>` : ""}
        <ol class="guide-list">
          ${(item.remediation || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </article>
    `)
    .join("");
}

function renderAdvisoryCards(items) {
  if (!items.length) {
    return `<div class="empty-callout">No firmware advisories are currently mapped for this model and version in the local advisory file.</div>`;
  }

  return items
    .map((item) => `
      <article class="analysis-card critical">
        <strong>${escapeHtml(item.title || "Security advisory")}</strong>
        <p>${escapeHtml(item.summary || "Review this advisory before leaving the current firmware in place.")}</p>
        <p>CVE(s): ${escapeHtml((item.cves || []).join(", ") || "n/a")}</p>
        <p>Recommended target: ${escapeHtml(item.recommendedTarget || "see firmware baseline")}</p>
      </article>
    `)
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
  const clientBehavior = selected.clientBehavior || {};
  const scoreExplanation = selected.site.scoreBreakdown?.length
    ? `This score is lower because of ${selected.site.scoreBreakdown.map((item) => `${item.label.toLowerCase()} (-${formatNumber(item.amount)})`).join(", ")}.`
    : "No active deductions are applied to this score right now.";

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
    <section class="detail-section top-space">
      <p class="eyebrow">Health Logic</p>
      <h4>Why This Site Scores ${formatNumber(selected.site.score)}%</h4>
      <p class="card-note">${escapeHtml(scoreExplanation)}</p>
      ${renderScoreBreakdown(selected.site)}
    </section>
    <section class="detail-section top-space">
      <p class="eyebrow">Warnings</p>
      <h4>Open Alarm Types And Remediation</h4>
      <div class="analysis-grid">${renderAlarmFindings(selected.site.alarms?.findings || [])}</div>
    </section>
    <div class="detail-grid secondary">
      <section class="detail-section">
        <p class="eyebrow">Client Behavior</p>
        <h4>Experience Summary</h4>
        <div class="chip-row">
          <span class="mini-pill">Score ${formatNumber(clientBehavior.score || 0)}%</span>
          <span class="mini-pill">Roaming ${escapeHtml(clientBehavior.roaming || "unknown")}</span>
          <span class="mini-pill">Band Balance ${escapeHtml(clientBehavior.bandBalance || "unknown")}</span>
        </div>
        <div class="metric-list">
          <div class="metric-row"><span>Wireless Clients</span><strong>${formatNumber(clientBehavior.wirelessClients || 0)}</strong></div>
          <div class="metric-row"><span>Wired Clients</span><strong>${formatNumber(clientBehavior.wiredClients || 0)}</strong></div>
          <div class="metric-row"><span>High Load APs</span><strong>${formatNumber(clientBehavior.highLoadAps || 0)}</strong></div>
          <div class="metric-row"><span>Sticky Client Risk APs</span><strong>${formatNumber(clientBehavior.stickyRiskAps || 0)}</strong></div>
          <div class="metric-row"><span>6 GHz-ready APs</span><strong>${formatNumber(clientBehavior.sixGhzReadyAps || 0)} / ${formatNumber(clientBehavior.totalAps || 0)}</strong></div>
        </div>
      </section>
      <section class="detail-section">
        <p class="eyebrow">Audit</p>
        <h4>Security And 6 GHz Readiness</h4>
        <div class="analysis-grid">${renderAuditCards(selected.audit || [])}</div>
      </section>
    </div>
    <section class="detail-section top-space">
      <p class="eyebrow">Optimization</p>
      <h4>Recommended Configuration Changes</h4>
      <div class="analysis-grid">${renderConfigCards(selected.configChanges || [])}</div>
    </section>
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

function renderTrendDetail() {
  const trend = getRoute().trend || state.selectedTrend;
  const points = state.history || [];
  const isHealth = trend === "health";
  const title = isHealth ? "Health Score History" : "Offline Device History";
  const latestSummary = state.dashboard?.summary || {};
  const rows = points
    .slice()
    .reverse()
    .slice(0, 20)
    .map((point) => `
      <tr>
        <td>${escapeHtml(formatDate(point.generatedAt))}</td>
        <td>${formatNumber(point.summary?.healthScore || 0)}%</td>
        <td>${formatNumber(point.summary?.offlineDevices || 0)}</td>
        <td>${formatNumber(point.summary?.warningAlarms || 0)}</td>
        <td>${formatNumber(point.summary?.criticalAlarms || 0)}</td>
      </tr>
    `)
    .join("");

  elements.trendDetailTitle.textContent = title;

  if (!points.length) {
    elements.trendDetail.className = "detail-empty";
    elements.trendDetail.textContent = "Trend history will appear after the dashboard has refreshed a few times.";
    return;
  }

  elements.trendDetail.className = "";
  elements.trendDetail.innerHTML = `
    <div class="detail-grid">
      <section class="detail-section">
        <p class="eyebrow">Trend Chart</p>
        <h4>${escapeHtml(title)}</h4>
        <svg id="trend-detail-chart" class="chart" viewBox="0 0 600 220" preserveAspectRatio="none"></svg>
      </section>
      <section class="detail-section">
        <p class="eyebrow">Current Snapshot</p>
        <h4>${isHealth ? "Why the score is not 100%" : "What is driving offline count"}</h4>
        ${
          isHealth
            ? `
              <p class="card-note">The organization score is an average of site scores. A site can be below 100% without being in a critical state if warnings or softer risk flags are present.</p>
              <div class="breakdown-grid">
                <div class="breakdown-card"><span class="breakdown-label">Org health score</span><strong>${formatNumber(latestSummary.healthScore || 0)}%</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Warnings</span><strong>${formatNumber(latestSummary.warningAlarms || 0)}</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Critical alarms</span><strong>${formatNumber(latestSummary.criticalAlarms || 0)}</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Risk flags</span><strong>${formatNumber(latestSummary.riskFlags || 0)}</strong></div>
              </div>
            `
            : `
              <div class="breakdown-grid">
                <div class="breakdown-card"><span class="breakdown-label">Offline devices</span><strong>${formatNumber(latestSummary.offlineDevices || 0)}</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Devices total</span><strong>${formatNumber(latestSummary.deviceCount || 0)}</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Access points</span><strong>${formatNumber(latestSummary.apCount || 0)}</strong></div>
                <div class="breakdown-card"><span class="breakdown-label">Switches</span><strong>${formatNumber(latestSummary.switchCount || 0)}</strong></div>
              </div>
            `
        }
      </section>
    </div>
    ${
      isHealth
        ? `
          <section class="detail-section top-space">
            <p class="eyebrow">Warnings</p>
            <h4>Current Open Alarm Categories</h4>
            <div class="analysis-grid">
              ${
                state.dashboard?.sites?.flatMap((entry) =>
                  (entry.site.alarms?.findings || []).map((item) => ({
                    ...item,
                    siteName: entry.site.name
                  }))
                ).length
                  ? state.dashboard.sites
                      .flatMap((entry) =>
                        (entry.site.alarms?.findings || []).map((item) => ({
                          ...item,
                          siteName: entry.site.name
                        }))
                      )
                      .slice(0, 10)
                      .map((item) => `
                        <article class="analysis-card ${escapeHtml(item.severity === "warning" ? "watch" : item.severity)}">
                          <strong>${escapeHtml(item.siteName)}: ${escapeHtml(item.title)}</strong>
                          <p>${escapeHtml(`${item.count} open ${item.severity} alarm${item.count === 1 ? "" : "s"}`)}</p>
                          <ol class="guide-list">
                            ${(item.remediation || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
                          </ol>
                        </article>
                      `)
                      .join("")
                  : `<div class="empty-callout">No open alarm details were returned in the current snapshot.</div>`
              }
            </div>
          </section>
        `
        : ""
    }
    <section class="detail-section top-space">
      <p class="eyebrow">Recent History</p>
      <h4>Snapshot Table</h4>
      <table class="history-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Health</th>
            <th>Offline</th>
            <th>Warnings</th>
            <th>Critical</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    ${
      isHealth && state.dashboard?.sites?.length
        ? `
          <section class="detail-section top-space">
            <p class="eyebrow">Site Breakdown</p>
            <h4>Current Site Score Drivers</h4>
            <div class="analysis-grid">
              ${state.dashboard.sites.map((entry) => `
                <article class="analysis-card">
                  <strong>${escapeHtml(entry.site.name)}: ${formatNumber(entry.site.score)}%</strong>
                  <p>${escapeHtml(
                    entry.site.scoreBreakdown?.length
                      ? entry.site.scoreBreakdown.map((item) => `${item.label} (-${formatNumber(item.amount)})`).join(", ")
                      : "No deductions currently applied."
                  )}</p>
                </article>
              `).join("")}
            </div>
          </section>
        `
        : ""
    }
  `;

  const detailChart = document.querySelector("#trend-detail-chart");
  renderChart(
    detailChart,
    points,
    (point) => (isHealth ? point.summary?.healthScore : point.summary?.offlineDevices),
    isHealth ? "#74d8ff" : "#ff6d6d",
    isHealth ? 100 : null
  );
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
  const configChangesMarkup = renderConfigCards(device.insights.configChanges || []);

  const firmwareMarkup = `
    <div class="metric-row"><span>Current Version</span><strong>${escapeHtml(device.insights.firmware.currentVersion || "unknown")}</strong></div>
    <div class="metric-row"><span>Newest Seen Same Model</span><strong>${escapeHtml(device.insights.firmware.newestSeenVersion || "n/a")}</strong></div>
    <div class="metric-row"><span>Recommended Baseline</span><strong>${escapeHtml(device.insights.firmware.recommendedVersion || "n/a")}</strong></div>
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
        <p class="eyebrow">Optimization</p>
        <h4>Recommended Configuration Changes</h4>
        <div class="analysis-grid">${configChangesMarkup}</div>
      </section>
    </div>
    <div class="detail-grid secondary">
      <section class="detail-section">
        <p class="eyebrow">Security</p>
        <h4>Firmware Advisories</h4>
        <div class="analysis-grid">${renderAdvisoryCards(device.insights.advisories || [])}</div>
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
  state.selectedTrend = route.trend || null;
  renderSummary(payload.summary);
  renderSites(payload.sites);
  await loadHistory(orgId);
  renderRouteView();
  if (getRoute().trend) {
    renderTrendDetail();
  }
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

elements.backToDashboardFromTrend.addEventListener("click", () => {
  state.selectedTrend = null;
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
    state.selectedTrend = route.trend || null;
    if (route.trend) {
      renderTrendDetail();
    }
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
