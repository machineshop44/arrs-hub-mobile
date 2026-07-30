import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  arrApiVersion,
  buildDefaultConfigs,
  type ProbeKind,
  type ServiceConfig,
} from "./services";

const STORAGE_KEY = "arrs-mobile-services-v3";
const ORDER_KEY = "arrs-mobile-module-order-v1";

export type ProbeResult = {
  up: boolean | null;
  latencyMs: number | null;
  message: string;
};

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
    const { value } = await Preferences.get({ key: STORAGE_KEY });
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
    key: STORAGE_KEY,
    value: JSON.stringify(services),
  });
}

/** User-defined module list order (service ids). */
export async function loadModuleOrder(): Promise<string[]> {
  try {
    const { value } = await Preferences.get({ key: ORDER_KEY });
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
    key: ORDER_KEY,
    value: JSON.stringify(ids),
  });
}
