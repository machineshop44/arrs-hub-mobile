import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  arrApiVersion,
  buildDefaultConfigs,
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

/** Direct probe failed because the host was unreachable (not an HTTP error). */
export function isDirectUnreachable(result: ProbeResult): boolean {
  if (result.viaHub) return false;
  if (result.up === true) return false;
  if (result.up === null) return result.message !== "No URL";
  // probeService sets latencyMs only when an HTTP response arrived
  return result.latencyMs == null;
}

/**
 * Fetch Arrs Hub watchdog board once. Returns per-service up/down as seen
 * from the hub machine (useful when the phone cannot reach a port directly).
 */
export async function fetchHubWatchdogServices(
  hubBaseUrl: string,
  timeoutMs = 6000,
): Promise<HubWatchdogServiceMap | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;

  try {
    const started = performance.now();
    let status = 0;
    let data: unknown = null;

    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url: `${base}/api/watchdog/status`,
        headers: { Accept: "application/json" },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      status = res.status;
      data =
        typeof res.data === "string"
          ? (() => {
              try {
                return JSON.parse(res.data);
              } catch {
                return null;
              }
            })()
          : res.data;
    } else {
      const res = await fetch(`${base}/api/watchdog/status`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      status = res.status;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }

    if (status < 200 || status >= 400 || !data || typeof data !== "object") {
      return null;
    }

    const services = (data as { services?: unknown }).services;
    if (!services || typeof services !== "object" || Array.isArray(services)) {
      return null;
    }

    const out: HubWatchdogServiceMap = {};
    for (const [id, raw] of Object.entries(
      services as Record<string, unknown>,
    )) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as {
        up?: unknown;
        latencyMs?: unknown;
        message?: unknown;
      };
      const up =
        row.up === true ? true : row.up === false ? false : null;
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
  } catch {
    return null;
  }
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

    if (service.id === "workouts") {
      // Workouts URL is Arrs Hub base — probe health, then workouts settings.
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
        // try workouts settings next
      }
      const { status, latencyMs } = await httpGet(
        `${base}/api/workouts/settings`,
      );
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
