import { hubGetJson, hubPostJson, normalizeBase } from "./http";
import {
  HubAuthError,
  isHubAuthFailure,
} from "./hubAuth";
import type { ServiceConfig } from "./services";
import { isCompanionOnlyUrl } from "./services";

export type ChipVersionApp = {
  id: string;
  label: string;
  version: string | null;
  updateAvailable?: boolean;
  latestVersion?: string | null;
  openUrl?: string | null;
  configured?: boolean;
  ok?: boolean;
  error?: string;
};

export type ChipVersionsPayload = {
  hub?: { version?: string | null; arrUpdateCount?: number };
  arrs?: ChipVersionApp[];
  companion?: {
    name?: string;
    version?: string | null;
    appUpdateCount?: number;
    apps?: ChipVersionApp[];
  } | null;
};

export type AppUpdateJobState = {
  id: string | null;
  appId: string | null;
  phase: "idle" | "running" | "done" | "error";
  message: string;
  error?: string | null;
};

/** URLs the hub chip-versions / summary APIs accept. Skip companion-only. */
export function statusUrlMap(
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
): Record<string, string> {
  const ids = [
    "sonarr",
    "radarr",
    "lidarr",
    "readarr",
    "prowlarr",
    "bazarr",
    "whisparr",
    "qbittorrent",
    "sabnzbd",
    "ombi",
    "tautulli",
    "fileflows",
  ];
  const out: Record<string, string> = {};
  for (const id of ids) {
    const service = services.find((s) => s.id === id && s.enabled);
    if (!service) continue;
    const url = resolveUrl(service).trim();
    if (!url || isCompanionOnlyUrl(url)) continue;
    out[id] = url;
  }
  return out;
}

function parseJob(raw: unknown): AppUpdateJobState | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const phase = row.phase;
  if (
    phase !== "idle" &&
    phase !== "running" &&
    phase !== "done" &&
    phase !== "error"
  ) {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : null,
    appId: typeof row.appId === "string" ? row.appId : null,
    phase,
    message: typeof row.message === "string" ? row.message : "",
    error: typeof row.error === "string" ? row.error : null,
  };
}

/** POST /api/status/chip-versions — null on older hubs / 404 / network. */
export async function fetchChipVersions(
  hubBaseUrl: string,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  timeoutMs = 15000,
): Promise<ChipVersionsPayload | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;
  try {
    const { status, data } = await hubPostJson(
      `${base}/api/status/chip-versions`,
      { urls: statusUrlMap(services, resolveUrl) },
      timeoutMs,
    );
    if (isHubAuthFailure(status)) throw new HubAuthError(status);
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      return null;
    }
    return data as ChipVersionsPayload;
  } catch (err) {
    if (err instanceof HubAuthError) throw err;
    console.warn(
      "[chipVersions] fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function startAppUpdate(
  hubBaseUrl: string,
  appId: string,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  pcId?: string,
  timeoutMs = 15000,
): Promise<AppUpdateJobState> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) throw new Error("Hub URL is not set");
  const urls = statusUrlMap(services, resolveUrl);
  const { status, data } = await hubPostJson(
    `${base}/api/status/app-update`,
    {
      id: appId,
      urls,
      baseUrl: urls[appId] || undefined,
      pcId: pcId || undefined,
    },
    timeoutMs,
  );
  const json = (data && typeof data === "object" ? data : {}) as {
    error?: string;
    job?: unknown;
  };
  if (isHubAuthFailure(status)) throw new HubAuthError(status);
  if (status < 200 || status >= 300) {
    throw new Error(json.error || `Update failed (HTTP ${status})`);
  }
  const job = parseJob(json.job);
  if (!job) {
    return {
      id: null,
      appId,
      phase: "running",
      message: "Starting update…",
      error: null,
    };
  }
  return job;
}

export async function fetchAppUpdateJob(
  hubBaseUrl: string,
  appId: string,
  timeoutMs = 8000,
): Promise<AppUpdateJobState | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;
  try {
    const { status, data } = await hubGetJson(
      `${base}/api/status/app-update?id=${encodeURIComponent(appId)}`,
      timeoutMs,
    );
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      return null;
    }
    return parseJob((data as { job?: unknown }).job);
  } catch {
    return null;
  }
}

export const CLICK_UPDATE_APP_IDS = new Set([
  "sonarr",
  "radarr",
  "lidarr",
  "readarr",
  "prowlarr",
  "whisparr",
  "tautulli",
  "qbittorrent",
  "sabnzbd",
]);

export const COMPANION_CLICK_UPDATE_IDS = new Set(["qbittorrent", "sabnzbd"]);
