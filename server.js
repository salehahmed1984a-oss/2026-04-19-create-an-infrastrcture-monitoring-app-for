import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const historyFile = path.join(dataDir, "history.json");

async function loadEnvFile() {
  const candidatePaths = [path.join(__dirname, ".env"), path.join(__dirname, ".env.example")];

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) {
      continue;
    }

    const raw = await readFile(filePath, "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    for (const entry of entries) {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    return filePath;
  }

  return null;
}

const loadedEnvFile = await loadEnvFile();

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const API_BASE_URL = (process.env.MIST_API_BASE_URL || "https://api.mist.com").replace(/\/$/, "");
const API_TOKEN = process.env.MIST_API_TOKEN || "";
const DEFAULT_ORG_ID = process.env.MIST_ORG_ID || "";
const MAX_HISTORY_SNAPSHOTS = Number.parseInt(process.env.MAX_HISTORY_SNAPSHOTS || "288", 10);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".cmd": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function resolveStaticPath(urlPathname) {
  const safePath = urlPathname === "/" ? "/index.html" : urlPathname;
  const fullPath = path.normalize(path.join(publicDir, safePath));
  if (!fullPath.startsWith(publicDir)) {
    return null;
  }
  return fullPath;
}

async function serveStatic(res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath || !existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
  });
  createReadStream(filePath).pipe(res);
}

function getAuthHeaders() {
  if (!API_TOKEN) {
    return null;
  }

  return {
    Authorization: `Token ${API_TOKEN}`,
    "Content-Type": "application/json"
  };
}

async function mistRequest(apiPath, searchParams = undefined) {
  const headers = getAuthHeaders();
  if (!headers) {
    return { ok: false, status: 500, error: "Missing MIST_API_TOKEN environment variable." };
  }

  const url = new URL(`${API_BASE_URL}${apiPath}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, { headers });
  const raw = await response.text();

  let data = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: typeof data === "string" ? data : data?.message || "Mist API request failed",
      details: data
    };
  }

  return { ok: true, status: response.status, data };
}

function normalizeDevice(device) {
  const status = device.status || device.state || "unknown";
  const uptime = Number(device.uptime || 0);
  const clients = Number(device.num_clients || device.clients || 0);
  const cpu = Number(device.cpu || 0);
  const memory = Number(device.mem || device.memory || 0);

  return {
    id: device.id || device.mac || `${device.name || "device"}-${Math.random().toString(16).slice(2)}`,
    name: device.name || device.hostname || device.mac || "Unnamed device",
    model: device.model || "Unknown",
    mac: device.mac || "n/a",
    status,
    uptime,
    clients,
    cpu,
    memory,
    ip: device.ip || device.ip_stat?.ip || "n/a",
    version: device.version || device.firmware_version || "n/a",
    lastSeen: device.last_seen || device.modified_time || null
  };
}

function severityCount(alarmCounts, severities) {
  return alarmCounts
    .filter((item) => severities.includes(String(item.severity || "").toLowerCase()))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
}

function computeDeviceHealthIndicators(devices) {
  const highCpuDevices = devices.filter((device) => Number(device.cpu || 0) >= 80).length;
  const highMemoryDevices = devices.filter((device) => Number(device.memory || 0) >= 80).length;
  const busyDevices = devices.filter((device) => Number(device.clients || 0) >= 25).length;

  return { highCpuDevices, highMemoryDevices, busyDevices };
}

function summarizeTopDevices(devices) {
  const byClients = [...devices]
    .sort((left, right) => Number(right.clients || 0) - Number(left.clients || 0))
    .slice(0, 5)
    .map((device) => ({
      name: device.name,
      clients: device.clients,
      cpu: device.cpu,
      memory: device.memory,
      status: device.status
    }));

  return byClients;
}

function computeSiteHealth(site, devices = [], alarmCounts = [], alarmTypes = []) {
  const online = devices.filter((device) => {
    const status = String(device.status || "").toLowerCase();
    return status.includes("connected") || status.includes("online");
  }).length;
  const offline = devices.filter((device) => {
    const status = String(device.status || "").toLowerCase();
    return status.includes("offline") || status.includes("disconnected");
  }).length;

  const warning = severityCount(alarmCounts, ["warn", "warning", "minor"]);
  const critical = severityCount(alarmCounts, ["critical", "major"]);
  const indicators = computeDeviceHealthIndicators(devices);

  let score = 100;
  score -= offline * 18;
  score -= critical * 12;
  score -= warning * 5;
  score -= indicators.highCpuDevices * 3;
  score -= indicators.highMemoryDevices * 3;
  score = Math.max(0, Math.min(100, score));

  let health = "healthy";
  if (score < 80) {
    health = "degraded";
  }
  if (score < 55 || critical > 0 || offline > 0) {
    health = "critical";
  }

  const totalClients = devices.reduce((sum, device) => sum + Number(device.clients || 0), 0);
  const avgCpu = devices.length
    ? Math.round(devices.reduce((sum, device) => sum + Number(device.cpu || 0), 0) / devices.length)
    : 0;
  const avgMemory = devices.length
    ? Math.round(devices.reduce((sum, device) => sum + Number(device.memory || 0), 0) / devices.length)
    : 0;

  return {
    id: site.id,
    name: site.name,
    sitegroupIds: site.sitegroup_ids || [],
    health,
    score,
    deviceCount: devices.length,
    onlineDevices: online,
    offlineDevices: offline,
    totalClients,
    avgCpu,
    avgMemory,
    utilizationRisk: indicators.highCpuDevices + indicators.highMemoryDevices + indicators.busyDevices,
    alarms: {
      warning,
      critical,
      total: alarmCounts.reduce((sum, item) => sum + Number(item.count || 0), 0),
      topTypes: alarmTypes.slice(0, 3)
    }
  };
}

async function readHistoryFile() {
  try {
    const raw = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendHistorySnapshot(snapshot) {
  await mkdir(dataDir, { recursive: true });
  const history = await readHistoryFile();
  const nextHistory = [...history, snapshot].slice(-MAX_HISTORY_SNAPSHOTS);
  await writeFile(historyFile, JSON.stringify(nextHistory, null, 2), "utf8");
}

function buildHistorySnapshot(dashboard) {
  return {
    generatedAt: dashboard.generatedAt,
    orgId: dashboard.orgId,
    summary: dashboard.summary,
    sites: dashboard.sites.map((entry) => ({
      id: entry.site.id,
      name: entry.site.name,
      health: entry.site.health,
      score: entry.site.score,
      deviceCount: entry.site.deviceCount,
      onlineDevices: entry.site.onlineDevices,
      offlineDevices: entry.site.offlineDevices,
      totalClients: entry.site.totalClients,
      warningAlarms: entry.site.alarms.warning,
      criticalAlarms: entry.site.alarms.critical,
      avgCpu: entry.site.avgCpu,
      avgMemory: entry.site.avgMemory
    }))
  };
}

async function getHistory(orgId, siteId) {
  const history = await readHistoryFile();
  const filtered = history.filter((entry) => entry.orgId === orgId);

  if (!siteId) {
    return filtered;
  }

  return filtered
    .map((entry) => {
      const site = entry.sites.find((item) => item.id === siteId);
      if (!site) {
        return null;
      }
      return {
        generatedAt: entry.generatedAt,
        orgId: entry.orgId,
        site
      };
    })
    .filter(Boolean);
}

async function fetchSiteData(site) {
  const [deviceStatsResult, alarmCountsResult, alarmTypeCountsResult, alarmsResult] = await Promise.all([
    mistRequest(`/api/v1/sites/${site.id}/stats/devices`),
    mistRequest(`/api/v1/sites/${site.id}/alarms/count`, { distinct: "severity", status: "open" }),
    mistRequest(`/api/v1/sites/${site.id}/alarms/count`, { distinct: "type", status: "open" }),
    mistRequest(`/api/v1/sites/${site.id}/alarms/search`, { status: "open", limit: 8 })
  ]);

  const devices = deviceStatsResult.ok && Array.isArray(deviceStatsResult.data)
    ? deviceStatsResult.data.map(normalizeDevice)
    : [];

  const alarmCounts = alarmCountsResult.ok && Array.isArray(alarmCountsResult.data?.results)
    ? alarmCountsResult.data.results
    : [];

  const alarmTypes = alarmTypeCountsResult.ok && Array.isArray(alarmTypeCountsResult.data?.results)
    ? alarmTypeCountsResult.data.results
        .map((item) => ({ type: item.type || item.value || "unknown", count: Number(item.count || 0) }))
        .sort((left, right) => right.count - left.count)
    : [];

  const openAlarms = alarmsResult.ok && Array.isArray(alarmsResult.data?.results)
    ? alarmsResult.data.results
    : [];

  return {
    site: computeSiteHealth(site, devices, alarmCounts, alarmTypes),
    devices,
    alarms: openAlarms,
    topDevices: summarizeTopDevices(devices),
    errors: {
      devices: deviceStatsResult.ok ? null : deviceStatsResult.error,
      alarms: alarmsResult.ok ? null : alarmsResult.error,
      alarmCounts: alarmCountsResult.ok ? null : alarmCountsResult.error
    }
  };
}

async function fetchDashboard(orgId) {
  const sitesResult = await mistRequest(`/api/v1/orgs/${orgId}/sites`);
  if (!sitesResult.ok) {
    return sitesResult;
  }

  const sites = Array.isArray(sitesResult.data) ? sitesResult.data : [];
  const siteCards = await Promise.all(sites.map((site) => fetchSiteData(site)));
  const summary = siteCards.reduce(
    (accumulator, entry) => {
      accumulator.siteCount += 1;
      accumulator.deviceCount += entry.site.deviceCount;
      accumulator.onlineDevices += entry.site.onlineDevices;
      accumulator.offlineDevices += entry.site.offlineDevices;
      accumulator.totalClients += entry.site.totalClients;
      accumulator.warningAlarms += entry.site.alarms.warning;
      accumulator.criticalAlarms += entry.site.alarms.critical;
      accumulator.avgScoreSum += entry.site.score;
      accumulator.utilizationRisk += entry.site.utilizationRisk;
      return accumulator;
    },
    {
      siteCount: 0,
      deviceCount: 0,
      onlineDevices: 0,
      offlineDevices: 0,
      totalClients: 0,
      warningAlarms: 0,
      criticalAlarms: 0,
      avgScoreSum: 0,
      utilizationRisk: 0
    }
  );

  summary.healthScore = summary.siteCount ? Math.round(summary.avgScoreSum / summary.siteCount) : 0;
  delete summary.avgScoreSum;

  const dashboard = {
    generatedAt: new Date().toISOString(),
    orgId,
    baseUrl: API_BASE_URL,
    summary,
    sites: siteCards.sort((left, right) => left.site.score - right.site.score)
  };

  await appendHistorySnapshot(buildHistorySnapshot(dashboard));

  return { ok: true, status: 200, data: dashboard };
}

async function handleApi(res, pathname, searchParams) {
  if (pathname === "/api/config") {
    sendJson(res, 200, {
      hasToken: Boolean(API_TOKEN),
      defaultOrgId: DEFAULT_ORG_ID,
      apiBaseUrl: API_BASE_URL,
      envFileLoaded: loadedEnvFile ? path.basename(loadedEnvFile) : null,
      maxHistorySnapshots: MAX_HISTORY_SNAPSHOTS
    });
    return;
  }

  if (pathname === "/api/dashboard") {
    const orgId = searchParams.get("orgId") || DEFAULT_ORG_ID;
    if (!orgId) {
      sendJson(res, 400, { error: "Missing orgId. Provide ?orgId=... or set MIST_ORG_ID." });
      return;
    }

    try {
      const result = await fetchDashboard(orgId);
      sendJson(res, result.status, result.ok ? result.data : result);
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error while building dashboard data.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/history") {
    const orgId = searchParams.get("orgId") || DEFAULT_ORG_ID;
    if (!orgId) {
      sendJson(res, 400, { error: "Missing orgId. Provide ?orgId=... or set MIST_ORG_ID." });
      return;
    }

    try {
      const siteId = searchParams.get("siteId");
      const history = await getHistory(orgId, siteId);
      sendJson(res, 200, { orgId, siteId, points: history });
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error while reading history.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/site") {
    const siteId = searchParams.get("siteId");
    if (!siteId) {
      sendJson(res, 400, { error: "Missing siteId query parameter." });
      return;
    }

    try {
      const siteResult = await mistRequest(`/api/v1/sites/${siteId}`);
      if (!siteResult.ok) {
        sendJson(res, siteResult.status, siteResult);
        return;
      }

      const siteDetails = await fetchSiteData(siteResult.data);
      sendJson(res, 200, { siteMeta: siteResult.data, ...siteDetails });
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error while loading site details.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Unknown API endpoint." });
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Bad request");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(res, url.pathname, url.searchParams);
    return;
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Mist monitor running on http://localhost:${PORT}`);
});
