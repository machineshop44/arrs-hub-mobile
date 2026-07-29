import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  buildDefaultConfigs,
  type ProbeKind,
  type ServiceConfig,
} from "./services";

const STORAGE_KEY = "arrs-mobile-services-v1";

export type ProbeResult = {
  up: boolean | null;
  latencyMs: number | null;
  message: string;
};

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function arrPingUrl(base: string): string {
  return `${normalizeBase(base)}/ping`;
}

function plexIdentityUrl(webUrl: string): string {
  try {
    const u = new URL(webUrl);
    return `${u.protocol}//${u.host}/identity`;
  } catch {
    return `${normalizeBase(webUrl)}/identity`;
  }
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
    return { up: null, latencyMs: null, message: "No URL configured" };
  }

  try {
    if (service.probe === "arr-ping") {
      const headers: Record<string, string> = {};
      if (service.apiKey.trim()) headers["X-Api-Key"] = service.apiKey.trim();
      const { status, latencyMs } = await httpGet(arrPingUrl(base), headers);
      const up = status >= 200 && status < 500;
      return {
        up,
        latencyMs,
        message: up ? `Ping ${status}` : `Ping failed (${status})`,
      };
    }

    if (service.probe === "plex") {
      const { status, latencyMs } = await httpGet(plexIdentityUrl(base));
      const up = status >= 200 && status < 500;
      return {
        up,
        latencyMs,
        message: up ? "Plex identity OK" : `Plex failed (${status})`,
      };
    }

    const { status, latencyMs } = await httpGet(base);
    const up = status >= 200 && status < 500;
    return {
      up,
      latencyMs,
      message: up ? `HTTP ${status}` : `HTTP ${status}`,
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
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (!value) return buildDefaultConfigs();
    const parsed = JSON.parse(value) as ServiceConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return buildDefaultConfigs();
    const defaults = buildDefaultConfigs();
    const byId = new Map(parsed.map((s) => [s.id, s]));
    return defaults.map((def) => {
      const saved = byId.get(def.id);
      if (!saved) return def;
      return {
        ...def,
        ...saved,
        probe: (saved.probe as ProbeKind) || def.probe,
        color: saved.color || def.color,
        name: saved.name || def.name,
      };
    });
  } catch {
    return buildDefaultConfigs();
  }
}

export async function saveServices(services: ServiceConfig[]): Promise<void> {
  await Preferences.set({
    key: STORAGE_KEY,
    value: JSON.stringify(services),
  });
}
