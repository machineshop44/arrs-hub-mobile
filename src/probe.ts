import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  arrApiVersion,
  buildDefaultConfigs,
  isCompanionOnlyService,
  type ProbeKind,
  type ServiceConfig,
} from "./services";

/** Capacitor Preferences key for the services snapshot (URLs, keys, creds). */
export const SERVICES_STORAGE_KEY = "arrs-mobile-services-v3";
/** Capacitor Preferences key for module list order. */
export const MODULE_ORDER_STORAGE_KEY = "arrs-mobile-module-order-v1";

export type ProbeResult = {
  up: boolean | null;
  latencyMs: number | null;
  message: string;
  /** True when status came from Arrs Hub watchdog instead of a direct probe. */
  viaHub?: boolean;
};

export type HubWatchdogServiceMap = Record<
  string,
  { up: boolean | null; latencyMs: number | null; message: string }
>;

export type HubWatchdogPcConfig = {
  id: string;
  name: string;
  host: string;
  mac: string;
  monitor: boolean;
  wakeOnLan: boolean;
  companionUrl: string;
  companionApiKeySet: boolean;
  companionId: string;
  lastRegisterAt: string | null;
};

export type HubWatchdogPcLive = {
  online: boolean | null;
  lastChecked?: string | null;
  message?: string;
  method?: string | null;
};

export type HubWatchdogWatchService = {
  restartPcId?: string;
  monitor?: boolean;
};

export type HubWatchdogStatus = {
  services: HubWatchdogServiceMap;
  pcs: Record<string, HubWatchdogPcLive>;
  settingsPcs: HubWatchdogPcConfig[];
  watchServices: Record<string, HubWatchdogWatchService>;
};

export type HubHealthInfo = {
  ok: boolean;
  version: string | null;
};

/**
 * Hub watchdog ids that may differ from mobile catalog ids.
 * Lookup is applied both directions when merging hub-first status.
 */
const HUB_SERVICE_ID_ALIASES: Record<string, string[]> = {
  ytarr: ["ytarr", "yt-arr", "yt_arr"],
  flaresolverr: ["flaresolverr", "flare-solverr", "flaresolver"],
  qbittorrent: ["qbittorrent", "qbit", "qbittorrent-nox"],
  sabnzbd: ["sabnzbd", "sab"],
  fileflows: ["fileflows", "file-flows"],
  "fileflows-node": ["fileflows-node", "fileflows_node", "fileflowsnode"],
};

/** Resolve hub watchdog row for a mobile service id (exact id, then aliases). */
export function hubStatusForService(
  hubServices: HubWatchdogServiceMap,
  serviceId: string,
): HubWatchdogServiceMap[string] | undefined {
  const direct = hubServices[serviceId];
  if (direct && direct.up !== null) return direct;
  if (direct) return direct;

  const aliases = HUB_SERVICE_ID_ALIASES[serviceId] || [serviceId];
  for (const alias of aliases) {
    const row = hubServices[alias];
    if (row && row.up !== null) return row;
  }
  for (const alias of aliases) {
    if (hubServices[alias]) return hubServices[alias];
  }

  // Reverse: hub key maps to this mobile id via alias tables.
  for (const [mobileId, list] of Object.entries(HUB_SERVICE_ID_ALIASES)) {
    if (mobileId === serviceId) continue;
    if (!list.includes(serviceId)) continue;
    const row = hubServices[mobileId];
    if (row) return row;
  }
  return undefined;
}

async function hubGet(
  hubBaseUrl: string,
  path: string,
  timeoutMs = 6000,
): Promise<{ status: number; data: unknown; started: number } | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;

  const started = performance.now();
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url: `${base}${path}`,
        headers: { Accept: "application/json" },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      const data =
        typeof res.data === "string"
          ? (() => {
              try {
                return JSON.parse(res.data);
              } catch {
                return null;
              }
            })()
          : res.data;
      return { status: res.status, data, started };
    }

    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data, started };
  } catch {
    return null;
  }
}

function parseWatchdogServices(
  services: unknown,
  started: number,
): HubWatchdogServiceMap | null {
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return null;
  }

  const out: HubWatchdogServiceMap = {};
  for (const [id, raw] of Object.entries(services as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as {
      up?: unknown;
      latencyMs?: unknown;
      message?: unknown;
    };
    const up = row.up === true ? true : row.up === false ? false : null;
    out[id] = {
      up,
      latencyMs:
        typeof row.latencyMs === "number"
          ? row.latencyMs
          : Math.round(performance.now() - started),
      message:
        typeof row.message === "string" && row.message.trim()
          ? row.message
          : up === true
            ? "Up"
            : up === false
              ? "Down"
              : "Unknown",
    };
  }
  return out;
}

function parseWatchdogPcs(raw: unknown): Record<string, HubWatchdogPcLive> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, HubWatchdogPcLive> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as {
      online?: unknown;
      lastChecked?: unknown;
      message?: unknown;
      method?: unknown;
    };
    out[id] = {
      online:
        row.online === true ? true : row.online === false ? false : null,
      lastChecked:
        typeof row.lastChecked === "string" ? row.lastChecked : null,
      message: typeof row.message === "string" ? row.message : undefined,
      method: typeof row.method === "string" ? row.method : null,
    };
  }
  return out;
}

function parseSettingsPcs(raw: unknown): HubWatchdogPcConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const pc = item as Record<string, unknown>;
      return {
        id: String(pc.id || ""),
        name: String(pc.name || "PC").trim() || "PC",
        host: String(pc.host || "").trim(),
        mac: String(pc.mac || "").trim(),
        monitor: pc.monitor !== false,
        wakeOnLan: pc.wakeOnLan !== false,
        companionUrl: String(pc.companionUrl || "").trim(),
        companionApiKeySet: Boolean(pc.companionApiKeySet),
        companionId: String(pc.companionId || "").trim(),
        lastRegisterAt:
          typeof pc.lastRegisterAt === "string" ? pc.lastRegisterAt : null,
      };
    })
    .filter((pc) => pc.id);
}

function parseWatchServices(
  raw: unknown,
): Record<string, HubWatchdogWatchService> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, HubWatchdogWatchService> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    const row = value as { restartPcId?: unknown; monitor?: unknown };
    out[id] = {
      restartPcId:
        typeof row.restartPcId === "string" ? row.restartPcId.trim() : "",
      monitor: row.monitor !== false,
    };
  }
  return out;
}

/** Parse Arrs Hub version from GET /api/health. */
export async function fetchHubHealth(
  hubBaseUrl: string,
  timeoutMs = 6000,
): Promise<HubHealthInfo | null> {
  const res = await hubGet(hubBaseUrl, "/api/health", timeoutMs);
  if (!res || res.status < 200 || res.status >= 400) return null;
  if (!res.data || typeof res.data !== "object") return null;
  const json = res.data as { ok?: unknown; version?: unknown };
  return {
    ok: json.ok === true,
    version: typeof json.version === "string" ? json.version : null,
  };
}

/**
 * Full watchdog status: service board, live PC probes, and settings PCs
 * (includes Companion-registered downloader PCs).
 */
export async function fetchHubWatchdogStatus(
  hubBaseUrl: string,
  timeoutMs = 6000,
): Promise<HubWatchdogStatus | null> {
  const res = await hubGet(hubBaseUrl, "/api/watchdog/status", timeoutMs);
  if (!res || res.status < 200 || res.status >= 400) return null;
  if (!res.data || typeof res.data !== "object") return null;

  const json = res.data as {
    services?: unknown;
    pcs?: unknown;
    settings?: { pcs?: unknown; services?: unknown };
  };
  const services = parseWatchdogServices(json.services, res.started);
  if (!services) return null;

  return {
    services,
    pcs: parseWatchdogPcs(json.pcs),
    settingsPcs: parseSettingsPcs(json.settings?.pcs),
    watchServices: parseWatchServices(json.settings?.services),
  };
}

/**
 * Fetch Arrs Hub watchdog board once. Primary status source when Hub is
 * configured; callers fall back to direct probes for missing/unknown rows.
 */
export async function fetchHubWatchdogServices(
  hubBaseUrl: string,
  timeoutMs = 6000,
): Promise<HubWatchdogServiceMap | null> {
  const status = await fetchHubWatchdogStatus(hubBaseUrl, timeoutMs);
  return status?.services ?? null;
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function loadSeed() {
  const modules = import.meta.glob<{ default: Record<string, unknown> }>(
    "./credentials.local.ts",
    { eager: true },
  );
  const mod = modules["./credentials.local.ts"];
  return (mod?.default ?? {}) as import("./services").CredentialSeed;
}

async function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<{ status: number; latencyMs: number }> {
  const started = performance.now();
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    return {
      status: res.status,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  return {
    status: res.status,
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function probeService(service: ServiceConfig): Promise<ProbeResult> {
  if (isCompanionOnlyService(service)) {
    return {
      up: null,
      latencyMs: null,
      message: "Status via Companion (no web UI)",
    };
  }

  const base = normalizeBase(service.url);
  if (!base) {
    return { up: null, latencyMs: null, message: "No URL" };
  }

  try {
    if (service.probe === "arr") {
      const headers: Record<string, string> = {};
      if (service.apiKey.trim()) headers["X-Api-Key"] = service.apiKey.trim();
      const path = service.apiKey.trim()
        ? `${base}/api/${arrApiVersion(service)}/system/status`
        : `${base}/ping`;
      const { status, latencyMs } = await httpGet(path, headers);
      const up = status >= 200 && status < 400;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    if (service.probe === "plex") {
      const { status, latencyMs } = await httpGet(`${base}/identity`);
      const up = status >= 200 && status < 500;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    if (service.id === "bazarr" && service.apiKey.trim()) {
      const headers = { "X-API-KEY": service.apiKey.trim() };
      const { status, latencyMs } = await httpGet(
        `${base}/api/system/status`,
        headers,
      );
      const up = status >= 200 && status < 400;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    if (service.id === "flaresolverr") {
      // Official lightweight health endpoint (GET /health on :8191).
      const { status, latencyMs } = await httpGet(`${base}/health`);
      const up = status >= 200 && status < 400;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    if (service.id === "ytarr") {
      const headers: Record<string, string> = {};
      if (service.apiKey.trim()) {
        headers["X-Api-Key"] = service.apiKey.trim();
      }
      // Prefer authenticated system status when a key is configured; health is public.
      const path = service.apiKey.trim()
        ? `${base}/api/system/status`
        : `${base}/api/health`;
      const { status, latencyMs } = await httpGet(path, headers);
      const up = status >= 200 && status < 400;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    if (service.id === "workouts" || service.id === "photo-dump") {
      // Hub-hosted modules — probe health, then module settings.
      try {
        const health = await httpGet(`${base}/api/health`);
        if (health.status >= 200 && health.status < 500) {
          return {
            up: true,
            latencyMs: health.latencyMs,
            message: "Online",
          };
        }
      } catch {
        // try module settings next
      }
      const settingsPath =
        service.id === "photo-dump"
          ? `${base}/api/photo-dump/settings`
          : `${base}/api/workouts/settings`;
      const { status, latencyMs } = await httpGet(settingsPath);
      const up = status >= 200 && status < 500;
      return {
        up,
        latencyMs,
        message: up ? "Online" : `HTTP ${status}`,
      };
    }

    const { status, latencyMs } = await httpGet(base);
    const up = status >= 200 && status < 500;
    return {
      up,
      latencyMs,
      message: up ? "Online" : `HTTP ${status}`,
    };
  } catch (err) {
    return {
      up: false,
      latencyMs: null,
      message: err instanceof Error ? err.message : "Unreachable",
    };
  }
}

export async function loadServices(): Promise<ServiceConfig[]> {
  const seed = await loadSeed();
  const defaults = buildDefaultConfigs(seed);
  try {
    const { value } = await Preferences.get({ key: SERVICES_STORAGE_KEY });
    if (!value) return defaults;
    const parsed = JSON.parse(value) as ServiceConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaults;
    const byId = new Map(parsed.map((s) => [s.id, s]));
    return defaults.map((def) => {
      const saved = byId.get(def.id);
      if (!saved) return def;
      return {
        ...def,
        url: saved.url || def.url,
        apiKey: saved.apiKey || def.apiKey,
        username: saved.username || def.username,
        password: saved.password || def.password,
        enabled: saved.enabled,
        // Always use catalog brand color / probe / auth
        color: def.color,
        probe: def.probe as ProbeKind,
        auth: def.auth,
        name: def.name,
      };
    });
  } catch {
    return defaults;
  }
}

export async function saveServices(services: ServiceConfig[]): Promise<void> {
  await Preferences.set({
    key: SERVICES_STORAGE_KEY,
    value: JSON.stringify(services),
  });
}

/** User-defined module list order (service ids). */
export async function loadModuleOrder(): Promise<string[]> {
  try {
    const { value } = await Preferences.get({ key: MODULE_ORDER_STORAGE_KEY });
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export async function saveModuleOrder(ids: string[]): Promise<void> {
  await Preferences.set({
    key: MODULE_ORDER_STORAGE_KEY,
    value: JSON.stringify(ids),
  });
}
