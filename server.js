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
const firmwareBaselinesFile = path.join(dataDir, "firmware-baselines.json");
const securityAdvisoriesFile = path.join(dataDir, "security-advisories.json");

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
    "Cache-Control": "no-store"
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

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.results)) {
    return value.results;
  }
  if (Array.isArray(value?.value)) {
    return value.value;
  }
  return [];
}

function formatEpochSeconds(value) {
  if (!value) {
    return null;
  }
  return new Date(Number(value) * 1000).toISOString();
}

function compareLooseVersions(leftValue, rightValue) {
  const tokenize = (value) => String(value || "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));

  const left = tokenize(leftValue);
  const right = tokenize(rightValue);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    if (typeof a === "number" && typeof b === "number" && a !== b) {
      return a > b ? 1 : -1;
    }
    if (String(a) !== String(b)) {
      return String(a) > String(b) ? 1 : -1;
    }
  }

  return 0;
}

function pickNewestVersion(versions = []) {
  return versions
    .filter(Boolean)
    .sort(compareLooseVersions)
    .at(-1) || null;
}

function normalizeApInventory(device, orgInventoryItem = null) {
  return {
    id: device.id || orgInventoryItem?.id,
    type: "ap",
    name: device.name || orgInventoryItem?.name || device.mac || "Unnamed AP",
    model: device.model || orgInventoryItem?.model || "Unknown",
    mac: device.mac || orgInventoryItem?.mac || "n/a",
    serial: device.serial || orgInventoryItem?.serial || "n/a",
    version: orgInventoryItem?.version || device.version || null,
    connected: Boolean(orgInventoryItem?.connected),
    txPower24: device.radio_config?.band_24?.power ?? null,
    txPower5: device.radio_config?.band_5?.power ?? null,
    tx24Disabled: Boolean(device.radio_config?.band_24?.disabled),
    tx5Disabled: Boolean(device.radio_config?.band_5?.disabled),
    meshRole: device.mesh?.role || null,
    siteId: device.site_id || orgInventoryItem?.site_id || null,
    createdTime: device.created_time || orgInventoryItem?.created_time || null,
    modifiedTime: device.modified_time || orgInventoryItem?.modified_time || null,
    raw: {
      inventory: device,
      orgInventory: orgInventoryItem
    }
  };
}

function normalizeApStats(device) {
  return {
    id: device.id || device.mac,
    type: "ap",
    status: device.status || device.state || "unknown",
    uptime: Number(device.uptime || 0),
    clients: Number(device.num_clients || device.clients || 0),
    cpu: Number(device.cpu || 0),
    memory: Number(device.mem || device.memory || 0),
    ip: device.ip || device.ip_stat?.ip || "n/a",
    version: device.version || device.firmware_version || null,
    lastSeen: device.last_seen || device.modified_time || null,
    raw: device
  };
}

function summarizeSwitchPorts(ifStat = {}) {
  const entries = Object.entries(ifStat).filter(([name]) => {
    const lower = name.toLowerCase();
    return lower.startsWith("ge-") || lower.startsWith("xe-") || lower.startsWith("et-") || lower.startsWith("mge-");
  });

  const upPorts = entries.filter(([, stats]) => Boolean(stats.up)).length;
  const downPorts = entries.length - upPorts;
  const busiest = entries
    .map(([name, stats]) => ({
      name,
      up: Boolean(stats.up),
      rxPkts: Number(stats.rx_pkts || 0),
      txPkts: Number(stats.tx_pkts || 0),
      vlan: stats.vlan || null
    }))
    .sort((left, right) => (right.rxPkts + right.txPkts) - (left.rxPkts + left.txPkts))
    .slice(0, 6);

  return {
    totalPorts: entries.length,
    upPorts,
    downPorts,
    busiest
  };
}

function summarizeSwitchEnvironment(moduleStat = []) {
  const fpc = moduleStat.find((module) => module.type === "fpc") || moduleStat[0] || {};
  const temperatures = Array.isArray(fpc.temperatures) ? fpc.temperatures : [];
  const maxTemperature = temperatures.length
    ? Math.max(...temperatures.map((sensor) => Number(sensor.celsius || 0)))
    : null;
  const nonOkSensors = temperatures.filter((sensor) => String(sensor.status || "").toLowerCase() !== "ok").length;

  return {
    poe: fpc.poe || null,
    maxTemperature,
    nonOkSensors,
    moduleVersion: fpc.version || null,
    pendingVersion: fpc.pending_version || null
  };
}

function normalizeSwitchInventory(device) {
  return {
    id: device.id,
    type: "switch",
    name: device.name || device.hostname || device.chassis_model || "Unnamed switch",
    hostname: device.hostname || device.name || null,
    model: device.model || device.chassis_model || "Unknown",
    mac: device.mac || device.chassis_mac || "n/a",
    serial: device.serial || device.chassis_serial || "n/a",
    version: device.version || null,
    connected: Boolean(device.connected),
    siteId: device.site_id || null,
    createdTime: device.created_time || null,
    modifiedTime: device.modified_time || null,
    raw: {
      orgInventory: device
    }
  };
}

function normalizeSwitchStats(device) {
  const portSummary = summarizeSwitchPorts(device.if_stat || {});
  const environment = summarizeSwitchEnvironment(device.module_stat || []);

  return {
    id: device.id || device._id || device.mac,
    type: "switch",
    status: device.status || "unknown",
    uptime: Number(device.uptime || 0),
    clients: Number(device.clients_stats?.total?.num_wired_clients || 0),
    connectedAps: Number(Array.isArray(device.clients_stats?.total?.num_aps) ? device.clients_stats.total.num_aps[0] || 0 : 0),
    cpu: Number(device.cpu_stat?.user || 0) + Number(device.cpu_stat?.system || 0),
    memory: Number(device.memory_stat?.usage || 0),
    ip: device.ip || device.ip_stat?.ip || device.ext_ip || "n/a",
    version: device.version || null,
    lastSeen: device.last_seen || null,
    fwVersionsOutOfSync: Boolean(device.fw_versions_outofsync),
    configStatus: device.config_status || null,
    configTimestamp: device.config_timestamp || null,
    pendingVersion: device.fwupdate?.pending_version || environment.pendingVersion || null,
    lastTrouble: device.last_trouble || null,
    power: environment.poe,
    maxTemperature: environment.maxTemperature,
    nonOkSensors: environment.nonOkSensors,
    portSummary,
    raw: device
  };
}

function mergeDeviceState(inventoryDevice = {}, statsDevice = {}) {
  return {
    ...inventoryDevice,
    ...statsDevice,
    id: statsDevice.id || inventoryDevice.id,
    name: inventoryDevice.name || statsDevice.name,
    model: inventoryDevice.model || statsDevice.model,
    mac: inventoryDevice.mac || statsDevice.mac,
    serial: inventoryDevice.serial || statsDevice.serial,
    version: statsDevice.version || inventoryDevice.version,
    status: statsDevice.status || (inventoryDevice.connected ? "connected" : "unknown"),
    raw: {
      inventory: inventoryDevice.raw || null,
      stats: statsDevice.raw || null
    }
  };
}

function buildModelVersionIndex(orgInventory = []) {
  const index = new Map();

  for (const device of orgInventory) {
    const key = `${device.type}:${device.model}`;
    const current = index.get(key) || [];
    if (device.version) {
      current.push(device.version);
    }
    index.set(key, current);
  }

  return index;
}

function deriveFirmwareAssessment(device, modelVersionIndex, firmwareBaselines = {}) {
  const key = `${device.type}:${device.model}`;
  const newestSeen = pickNewestVersion(modelVersionIndex.get(key) || []);
  const current = device.version || null;
  const drift = current && newestSeen ? compareLooseVersions(current, newestSeen) < 0 : false;
  const baselineGroup = firmwareBaselines?.[device.type] || {};
  const baseline = baselineGroup[device.model] || null;
  const recommendedVersion = baseline?.recommended || null;
  const behindRecommended = current && recommendedVersion ? compareLooseVersions(current, recommendedVersion) < 0 : false;

  return {
    currentVersion: current,
    newestSeenVersion: newestSeen,
    recommendedVersion,
    drift,
    behindRecommended,
    reviewRecommended: Boolean(drift || behindRecommended || device.pendingVersion || device.fwVersionsOutOfSync),
    baselineNotes: baseline?.notes || null
  };
}

function buildDeviceInsights(device, previousDevice = null, modelVersionIndex = new Map(), firmwareBaselines = {}, securityAdvisories = {}) {
  const firmware = deriveFirmwareAssessment(device, modelVersionIndex, firmwareBaselines);
  const recommendations = [];
  const observations = [];
  const configChanges = [];
  const modelAdvisories = securityAdvisories?.[device.type]?.[device.model] || [];
  const advisories = modelAdvisories.filter((advisory) => {
    const affectedVersions = Array.isArray(advisory.affectedVersions) ? advisory.affectedVersions : [];
    return affectedVersions.length === 0 || affectedVersions.includes(device.version);
  });

  if (device.status && !String(device.status).toLowerCase().includes("connected") && !String(device.status).toLowerCase().includes("online")) {
    recommendations.push(`${device.name} is not connected right now.`);
  }

  if (firmware.drift) {
    recommendations.push(`${device.name} is running ${firmware.currentVersion}, behind the newest ${device.model} version seen in the org (${firmware.newestSeenVersion}).`);
  }
  if (firmware.behindRecommended && firmware.recommendedVersion) {
    recommendations.push(`${device.name} is behind the recommended ${device.model} baseline (${firmware.recommendedVersion}).`);
    configChanges.push(`Upgrade this ${device.model} to the recommended baseline ${firmware.recommendedVersion} after validating the maintenance window and rollback plan.`);
  }
  if (advisories.length > 0 && firmware.recommendedVersion) {
    recommendations.push(`${device.name} has ${advisories.length} security advisory entries associated with the current firmware. Upgrade toward ${firmware.recommendedVersion}.`);
  }

  if (device.type === "ap") {
    if (device.clients >= 25) {
      recommendations.push(`${device.name} is carrying a high client load (${device.clients}).`);
      configChanges.push("Review client distribution and consider reducing transmit power or adding nearby AP capacity if clients are sticking to this AP.");
    }
    if (device.txPower5 !== null || device.txPower24 !== null) {
      observations.push(`Current radio power: 2.4 GHz ${device.txPower24 ?? "n/a"} dBm, 5 GHz ${device.txPower5 ?? "n/a"} dBm.`);
    }
    if (device.meshRole) {
      observations.push(`Mesh role: ${device.meshRole}.`);
    }
    if (device.txPower24 !== null && device.txPower24 >= 18) {
      configChanges.push("2.4 GHz power is relatively high. If roaming is sticky or channel contention is high, consider lowering 2.4 GHz transmit power and favoring 5 GHz coverage.");
    }
    if (device.tx5Disabled) {
      configChanges.push("5 GHz radio is disabled. Re-enable it if this AP should serve normal client traffic rather than a special-purpose coverage role.");
    }
    if (previousDevice && (previousDevice.txPower24 !== device.txPower24 || previousDevice.txPower5 !== device.txPower5)) {
      recommendations.push(`${device.name} had a radio power change since the previous snapshot.`);
      configChanges.push("Radio power changed since the previous snapshot. Review whether this was expected from RRM or a recent manual configuration change.");
    }
  }

  if (device.type === "switch") {
    if (device.power?.power_draw !== undefined) {
      observations.push(`PoE draw ${device.power.power_draw}W of ${device.power.max_power}W available, ${device.power.power_reserved}W reserved.`);
      if (device.power.max_power && device.power.power_reserved / device.power.max_power > 0.8) {
        configChanges.push("PoE reservation is high relative to available budget. Review connected powered devices and consider PoE budgeting adjustments.");
      }
    }
    if (device.maxTemperature !== null) {
      observations.push(`Highest reported switch temperature is ${device.maxTemperature}°C.`);
      if (device.maxTemperature >= 60) {
        configChanges.push("Switch temperature is elevated. Review airflow, rack ventilation, and power density around this switch.");
      }
    }
    if (device.portSummary?.downPorts > 0) {
      observations.push(`${device.portSummary.upPorts}/${device.portSummary.totalPorts} data ports are up.`);
      if (device.portSummary.downPorts >= Math.max(4, Math.round(device.portSummary.totalPorts * 0.5))) {
        configChanges.push("Many switch ports are down. Review whether unused edge ports should be disabled or documented as spare capacity.");
      }
    }
    if (device.nonOkSensors > 0) {
      recommendations.push(`${device.name} has ${device.nonOkSensors} environmental sensors reporting a non-ok state.`);
    }
    if (device.pendingVersion) {
      recommendations.push(`${device.name} has a pending firmware version (${device.pendingVersion}).`);
      configChanges.push("A pending switch firmware version exists. Review the maintenance window and staged upgrade plan for this switch.");
    }
    if (device.fwVersionsOutOfSync) {
      recommendations.push(`${device.name} reports firmware versions out of sync.`);
      configChanges.push("Firmware is out of sync across switch components. Review upgrade consistency before applying further configuration changes.");
    }
  }

  return { firmware, observations, recommendations, configChanges, advisories };
}

function summarizeTopDevices(devices) {
  return [...devices]
    .sort((left, right) => Number(right.clients || 0) - Number(left.clients || 0))
    .slice(0, 5)
    .map((device) => ({
      id: device.id,
      type: device.type,
      name: device.name,
      model: device.model,
      clients: device.clients || 0,
      cpu: device.cpu || 0,
      memory: device.memory || 0,
      status: device.status
    }));
}

const AP_MODEL_CAPABILITIES = {
  AP24: { generation: "Wi-Fi 6E", sixGhz: true },
  AP34: { generation: "Wi-Fi 6E", sixGhz: true },
  AP45: { generation: "Wi-Fi 6E", sixGhz: true },
  AP45E: { generation: "Wi-Fi 6E", sixGhz: true },
  AP64: { generation: "Wi-Fi 6E", sixGhz: true },
  AP36: { generation: "Wi-Fi 7", sixGhz: true },
  AP37: { generation: "Wi-Fi 7", sixGhz: true },
  AP47: { generation: "Wi-Fi 7", sixGhz: true }
};

function getApCapability(device) {
  const model = String(device.model || "").toUpperCase();
  return AP_MODEL_CAPABILITIES[model] || { generation: "Unknown", sixGhz: false };
}

function buildHardwareInventorySummary(accessPoints = [], switches = []) {
  const apModels = new Map();
  const switchModels = new Map();

  for (const device of accessPoints) {
    apModels.set(device.model, (apModels.get(device.model) || 0) + 1);
  }
  for (const device of switches) {
    switchModels.set(device.model, (switchModels.get(device.model) || 0) + 1);
  }

  return {
    apModels: [...apModels.entries()].map(([model, count]) => ({ model, count })),
    switchModels: [...switchModels.entries()].map(([model, count]) => ({ model, count }))
  };
}

function buildSyntheticClientBehavior(accessPoints = [], switches = []) {
  const totalWirelessClients = accessPoints.reduce((sum, device) => sum + Number(device.clients || 0), 0);
  const totalWiredClients = switches.reduce((sum, device) => sum + Number(device.clients || 0), 0);
  const highLoadAps = accessPoints.filter((device) => Number(device.clients || 0) >= 20).length;
  const stickyRiskAps = accessPoints.filter((device) => Number(device.txPower24 || 0) >= 18).length;
  const sixGhzReadyAps = accessPoints.filter((device) => getApCapability(device).sixGhz).length;
  const totalAps = accessPoints.length;

  let score = 100;
  score -= highLoadAps * 10;
  score -= stickyRiskAps * 6;
  score = Math.max(0, Math.min(100, score));

  const roaming = highLoadAps === 0 ? "good" : highLoadAps >= 2 ? "poor" : "watch";
  const bandBalance = stickyRiskAps === 0 ? "good" : stickyRiskAps >= 2 ? "poor" : "watch";

  return {
    score,
    wirelessClients: totalWirelessClients,
    wiredClients: totalWiredClients,
    roaming,
    bandBalance,
    highLoadAps,
    stickyRiskAps,
    sixGhzReadyAps,
    totalAps
  };
}

function buildSecurityAndSixGhzAudit(site, accessPoints = [], switches = []) {
  const auditItems = [];
  const configChanges = [];
  const sixGhzReadyAps = accessPoints.filter((device) => getApCapability(device).sixGhz);
  const hardwareInventory = buildHardwareInventorySummary(accessPoints, switches);

  if (sixGhzReadyAps.length === 0) {
    auditItems.push({
      severity: "watch",
      title: "No obvious 6 GHz-capable AP models detected",
      detail: "This site currently appears to be built on AP models without obvious Wi-Fi 6E/7 capability, so 6 GHz enablement may require hardware upgrades first."
    });
  } else {
    auditItems.push({
      severity: "recommended",
      title: "6 GHz readiness review available",
      detail: `${sixGhzReadyAps.length} APs appear 6 GHz-capable by model family. Review WLAN security and radio-band settings so 6 GHz-capable clients can use them.`
    });
    configChanges.push("If you have WPA3-capable client devices, create or update a secure WLAN to explicitly enable 6 GHz and validate client onboarding before broad rollout.");
  }

  if (hardwareInventory.apModels.length > 0) {
    const modelText = hardwareInventory.apModels.map((item) => `${item.model} x${item.count}`).join(", ");
    auditItems.push({
      severity: "recommended",
      title: "AP hardware inventory confirmed",
      detail: `Detected AP models on this site: ${modelText}. 6 GHz readiness is based on these specific hardware families rather than a generic assumption.`
    });
  }

  if (hardwareInventory.switchModels.length > 0) {
    const modelText = hardwareInventory.switchModels.map((item) => `${item.model} x${item.count}`).join(", ");
    auditItems.push({
      severity: "recommended",
      title: "Switch hardware inventory confirmed",
      detail: `Detected switch models on this site: ${modelText}. Security and optimization checks are being grounded in the actual hardware present at the site.`
    });
  }

  const highPowerAps = accessPoints.filter((device) => Number(device.txPower24 || 0) >= 18);
  if (highPowerAps.length > 0) {
    auditItems.push({
      severity: "recommended",
      title: "2.4 GHz power review",
      detail: `${highPowerAps.length} APs have relatively high configured 2.4 GHz power, which can contribute to sticky client behavior and co-channel contention.`
    });
    configChanges.push("Review 2.4 GHz minimum and maximum power settings for this site and reduce them if roaming and channel contention are concerns.");
  }

  const overloadedSwitches = switches.filter((device) => {
    const reserved = Number(device.power?.power_reserved || 0);
    const max = Number(device.power?.max_power || 0);
    return max > 0 && reserved / max > 0.8;
  });
  if (overloadedSwitches.length > 0) {
    auditItems.push({
      severity: "critical",
      title: "PoE budget close to exhaustion",
      detail: `${overloadedSwitches.length} switches are reserving most of their PoE budget, which can become a scaling risk for new APs, cameras, or phones.`
    });
    configChanges.push("Review switch PoE budgets, endpoint classes, and future expansion plans before adding more powered devices.");
  }

  const sparsePorts = switches.filter((device) => Number(device.portSummary?.downPorts || 0) >= Math.max(4, Math.round(Number(device.portSummary?.totalPorts || 0) * 0.5)));
  if (sparsePorts.length > 0) {
    auditItems.push({
      severity: "watch",
      title: "Unused port hardening opportunity",
      detail: `${sparsePorts.length} switches have a large proportion of down ports. Unused ports should be disabled or placed into a locked-down profile where possible.`
    });
    configChanges.push("Apply disabled or restricted port profiles to unused switch access ports, and keep uplink/AP/IoT ports on explicit profiles instead of defaults.");
  }

  auditItems.push({
    severity: "recommended",
    title: "WPA3 and NAC posture review",
    detail: "For secure WLANs and future 6 GHz use, review WLAN security types for WPA3 readiness and use 802.1X / EAP-TLS for managed users and devices where feasible."
  });
  configChanges.push("Review secure SSIDs and move them toward WPA3-Enterprise where client support allows; use OWE Transition for guest 6 GHz if you need open-style guest access with modern encryption.");
  configChanges.push("For wired security, use 802.1X for supported endpoints and MAB only for exceptions such as IoT or legacy devices.");

  return {
    items: auditItems,
    configChanges: [...new Set(configChanges)]
  };
}

function computeSiteHealth(site, accessPoints = [], switches = [], alarmCounts = []) {
  const devices = [...accessPoints, ...switches];
  const onlineDevices = devices.filter((device) => {
    const status = String(device.status || "").toLowerCase();
    return status.includes("connected") || status.includes("online");
  }).length;
  const offlineDevices = devices.filter((device) => {
    const status = String(device.status || "").toLowerCase();
    return status.includes("offline") || status.includes("disconnected");
  }).length;
  const warning = alarmCounts
    .filter((item) => ["warn", "warning", "minor"].includes(String(item.severity || "").toLowerCase()))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  const critical = alarmCounts
    .filter((item) => ["critical", "major"].includes(String(item.severity || "").toLowerCase()))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);

  const apCount = accessPoints.length;
  const switchCount = switches.length;
  const totalClients = devices.reduce((sum, device) => sum + Number(device.clients || 0), 0);
  const avgCpu = devices.length ? Math.round(devices.reduce((sum, device) => sum + Number(device.cpu || 0), 0) / devices.length) : 0;
  const avgMemory = devices.length ? Math.round(devices.reduce((sum, device) => sum + Number(device.memory || 0), 0) / devices.length) : 0;
  const riskFlags = devices.filter((device) => Number(device.clients || 0) >= 25 || Number(device.cpu || 0) >= 80 || Number(device.memory || 0) >= 80).length;

  let score = 100;
  const scoreBreakdown = [];

  if (offlineDevices > 0) {
    score -= offlineDevices * 16;
    scoreBreakdown.push({ label: "Offline devices", amount: offlineDevices * 16 });
  }
  if (critical > 0) {
    score -= critical * 12;
    scoreBreakdown.push({ label: "Critical alarms", amount: critical * 12 });
  }
  if (warning > 0) {
    score -= warning * 5;
    scoreBreakdown.push({ label: "Warning alarms", amount: warning * 5 });
  }
  if (riskFlags > 0) {
    score -= riskFlags * 3;
    scoreBreakdown.push({ label: "Risk flags", amount: riskFlags * 3 });
  }
  score = Math.max(0, Math.min(100, score));

  let health = "healthy";
  if (score < 80) {
    health = "degraded";
  }
  if (score < 55 || critical > 0 || offlineDevices > 0) {
    health = "critical";
  }

  return {
    id: site.id,
    name: site.name,
    health,
    score,
    deviceCount: devices.length,
    apCount,
    switchCount,
    onlineDevices,
    offlineDevices,
    totalClients,
    avgCpu,
    avgMemory,
    riskFlags,
    scoreBreakdown,
    alarms: {
      warning,
      critical,
      total: alarmCounts.reduce((sum, item) => sum + Number(item.count || 0), 0)
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

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
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
      score: entry.site.score,
      health: entry.site.health,
      offlineDevices: entry.site.offlineDevices,
      totalClients: entry.site.totalClients,
      devices: [...entry.accessPoints, ...entry.switches].map((device) => ({
        id: device.id,
        type: device.type,
        name: device.name,
        model: device.model,
        siteId: entry.site.id,
        status: device.status,
        version: device.version,
        clients: device.clients || 0,
        cpu: device.cpu || 0,
        memory: device.memory || 0,
        uptime: device.uptime || 0,
        lastSeen: device.lastSeen || null,
        txPower24: device.txPower24 ?? null,
        txPower5: device.txPower5 ?? null,
        poeDraw: device.power?.power_draw ?? null,
        poeReserved: device.power?.power_reserved ?? null,
        poeMax: device.power?.max_power ?? null,
        upPorts: device.portSummary?.upPorts ?? null,
        downPorts: device.portSummary?.downPorts ?? null
      }))
    }))
  };
}

async function getHistory(orgId, filters = {}) {
  const history = await readHistoryFile();
  const filtered = history.filter((entry) => entry.orgId === orgId);

  if (!filters.siteId && !filters.deviceId) {
    return filtered;
  }

  return filtered
    .map((entry) => {
      const site = entry.sites.find((item) => !filters.siteId || item.id === filters.siteId);
      if (!site) {
        return null;
      }

      if (!filters.deviceId) {
        return {
          generatedAt: entry.generatedAt,
          orgId: entry.orgId,
          site
        };
      }

      const siteDevices = Array.isArray(site.devices) ? site.devices : [];
      const device = siteDevices.find((item) => item.id === filters.deviceId);
      if (!device) {
        return null;
      }

      return {
        generatedAt: entry.generatedAt,
        orgId: entry.orgId,
        siteId: site.id,
        siteName: site.name,
        device
      };
    })
    .filter(Boolean);
}

function flattenHistoryDevices(history) {
  return history.flatMap((entry) =>
    (Array.isArray(entry.sites) ? entry.sites : []).flatMap((site) =>
      (Array.isArray(site.devices) ? site.devices : []).map((device) => ({
        generatedAt: entry.generatedAt,
        siteId: site.id,
        siteName: site.name,
        ...device
      }))
    )
  );
}

async function fetchDashboard(orgId) {
  const [sitesResult, orgInventoryResult, history, firmwareBaselines, securityAdvisories] = await Promise.all([
    mistRequest(`/api/v1/orgs/${orgId}/sites`),
    mistRequest(`/api/v1/orgs/${orgId}/inventory`),
    readHistoryFile(),
    readJsonFile(firmwareBaselinesFile, { ap: {}, switch: {} }),
    readJsonFile(securityAdvisoriesFile, { ap: {}, switch: {} })
  ]);

  if (!sitesResult.ok) {
    return sitesResult;
  }
  if (!orgInventoryResult.ok) {
    return orgInventoryResult;
  }

  const sites = toArray(sitesResult.data);
  const orgInventory = toArray(orgInventoryResult.data);
  const modelVersionIndex = buildModelVersionIndex(orgInventory);
  const previousDeviceHistory = new Map(flattenHistoryDevices(history).map((item) => [item.id, item]));

  const siteCards = await Promise.all(
    sites.map(async (site) => {
      const [siteDevicesResult, apStatsResult, switchStatsResult, alarmCountsResult] = await Promise.all([
        mistRequest(`/api/v1/sites/${site.id}/devices`),
        mistRequest(`/api/v1/sites/${site.id}/stats/devices`),
        mistRequest(`/api/v1/sites/${site.id}/stats/devices`, { type: "switch" }),
        mistRequest(`/api/v1/sites/${site.id}/alarms/count`, { distinct: "severity", status: "open" })
      ]);

      const siteInventory = toArray(siteDevicesResult.data);
      const apStats = toArray(apStatsResult.data);
      const switchStats = toArray(switchStatsResult.data);
      const orgDevicesForSite = orgInventory.filter((device) => device.site_id === site.id);

      const apInventoryById = new Map();
      for (const device of siteInventory.filter((item) => item.type === "ap")) {
        const orgItem = orgDevicesForSite.find((item) => item.id === device.id);
        apInventoryById.set(device.id, normalizeApInventory(device, orgItem));
      }

      for (const orgItem of orgDevicesForSite.filter((item) => item.type === "ap")) {
        if (!apInventoryById.has(orgItem.id)) {
          apInventoryById.set(orgItem.id, normalizeApInventory({ id: orgItem.id, site_id: site.id }, orgItem));
        }
      }

      const switchInventoryById = new Map(
        orgDevicesForSite
          .filter((item) => item.type === "switch")
          .map((item) => [item.id, normalizeSwitchInventory(item)])
      );

      const accessPoints = apStats.map((stats) => {
        const merged = mergeDeviceState(apInventoryById.get(stats.id), normalizeApStats(stats));
        const previous = previousDeviceHistory.get(merged.id);
        return {
          ...merged,
          insights: buildDeviceInsights(merged, previous, modelVersionIndex, firmwareBaselines, securityAdvisories)
        };
      });

      const switches = switchStats.map((stats) => {
        const merged = mergeDeviceState(switchInventoryById.get(stats.id), normalizeSwitchStats(stats));
        const previous = previousDeviceHistory.get(merged.id);
        return {
          ...merged,
          insights: buildDeviceInsights(merged, previous, modelVersionIndex, firmwareBaselines, securityAdvisories)
        };
      });

      const alarmCounts = toArray(alarmCountsResult.data);
      const siteHealth = computeSiteHealth(site, accessPoints, switches, alarmCounts);
      const allDevices = [...accessPoints, ...switches];
      const recommendations = allDevices.flatMap((device) => device.insights.recommendations).slice(0, 8);
      const configChanges = allDevices.flatMap((device) => device.insights.configChanges || []).slice(0, 8);
      const clientBehavior = buildSyntheticClientBehavior(accessPoints, switches);
      const audit = buildSecurityAndSixGhzAudit(site, accessPoints, switches);

      return {
        site: siteHealth,
        accessPoints,
        switches,
        topDevices: summarizeTopDevices(allDevices),
        recommendations,
        configChanges: [...new Set([...configChanges, ...audit.configChanges])].slice(0, 12),
        audit: audit.items,
        clientBehavior,
        trendContext: {
          healthScore: siteHealth.score,
          offlineDevices: siteHealth.offlineDevices
        },
        errors: {
          siteDevices: siteDevicesResult.ok ? null : siteDevicesResult.error,
          apStats: apStatsResult.ok ? null : apStatsResult.error,
          switchStats: switchStatsResult.ok ? null : switchStatsResult.error,
          alarms: alarmCountsResult.ok ? null : alarmCountsResult.error
        }
      };
    })
  );

  const summary = siteCards.reduce(
    (accumulator, entry) => {
      accumulator.siteCount += 1;
      accumulator.deviceCount += entry.site.deviceCount;
      accumulator.apCount += entry.site.apCount;
      accumulator.switchCount += entry.site.switchCount;
      accumulator.onlineDevices += entry.site.onlineDevices;
      accumulator.offlineDevices += entry.site.offlineDevices;
      accumulator.totalClients += entry.site.totalClients;
      accumulator.warningAlarms += entry.site.alarms.warning;
      accumulator.criticalAlarms += entry.site.alarms.critical;
      accumulator.healthScoreSum += entry.site.score;
      accumulator.riskFlags += entry.site.riskFlags;
      return accumulator;
    },
    {
      siteCount: 0,
      deviceCount: 0,
      apCount: 0,
      switchCount: 0,
      onlineDevices: 0,
      offlineDevices: 0,
      totalClients: 0,
      warningAlarms: 0,
      criticalAlarms: 0,
      healthScoreSum: 0,
      riskFlags: 0
    }
  );

  summary.healthScore = summary.siteCount ? Math.round(summary.healthScoreSum / summary.siteCount) : 0;
  delete summary.healthScoreSum;

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

async function fetchDeviceDetail(siteId, deviceId, orgId) {
  const dashboardResult = await fetchDashboard(orgId);
  if (!dashboardResult.ok) {
    return dashboardResult;
  }

  const siteEntry = dashboardResult.data.sites.find((entry) => entry.site.id === siteId);
  if (!siteEntry) {
    return { ok: false, status: 404, error: "Site not found in dashboard." };
  }

  const device = [...siteEntry.accessPoints, ...siteEntry.switches].find((item) => item.id === deviceId);
  if (!device) {
    return { ok: false, status: 404, error: "Device not found on this site." };
  }

  const history = await getHistory(orgId, { siteId, deviceId });

  return {
    ok: true,
    status: 200,
    data: {
      generatedAt: dashboardResult.data.generatedAt,
      site: siteEntry.site,
      device,
      history
    }
  };
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
    const siteId = searchParams.get("siteId") || null;
    const deviceId = searchParams.get("deviceId") || null;

    if (!orgId) {
      sendJson(res, 400, { error: "Missing orgId. Provide ?orgId=... or set MIST_ORG_ID." });
      return;
    }

    try {
      const history = await getHistory(orgId, { siteId, deviceId });
      sendJson(res, 200, { orgId, siteId, deviceId, points: history });
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error while reading history.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/device") {
    const orgId = searchParams.get("orgId") || DEFAULT_ORG_ID;
    const siteId = searchParams.get("siteId");
    const deviceId = searchParams.get("deviceId");

    if (!orgId || !siteId || !deviceId) {
      sendJson(res, 400, { error: "Missing orgId, siteId, or deviceId." });
      return;
    }

    try {
      const result = await fetchDeviceDetail(siteId, deviceId, orgId);
      sendJson(res, result.status, result.ok ? result.data : result);
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error while loading device details.",
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
