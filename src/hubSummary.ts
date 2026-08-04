import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { ServiceConfig } from "./services";

export type ArrQueueIssue = {
  id?: number | null;
  title: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  errorMessage?: string;
  outputPath?: string;
};

export type ArrQueueApp = {
  ok: boolean;
  configured?: boolean;
  total: number;
  downloading?: number;
  issues?: ArrQueueIssue[];
  error?: string;
};

export type OmbiPendingItem = {
  id: number;
  type: "movie" | "tv" | "music";
  title: string;
  requester?: string;
};

export type HubStatusSummary = {
  ok: boolean;
  checkedAt?: string;
  streams?: {
    ok: boolean;
    configured: boolean;
    streamCount: number;
    error?: string;
  };
  downloads?: {
    active: number;
    qbittorrent?: { ok: boolean; configured: boolean; active: number };
    sabnzbd?: { ok: boolean; configured: boolean; active: number };
  };
  ombi?: {
    ok: boolean;
    configured: boolean;
    pending: number;
    error?: string;
  };
  arr?: {
    queueTotal: number;
    sonarr?: ArrQueueApp;
    radarr?: ArrQueueApp;
    lidarr?: ArrQueueApp;
  };
};

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function summaryUrlMap(
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
): Record<string, string> {
  const ids = [
    "sonarr",
    "radarr",
    "lidarr",
    "qbittorrent",
    "sabnzbd",
    "ombi",
    "tautulli",
  ];
  const out: Record<string, string> = {};
  for (const id of ids) {
    const service = services.find((s) => s.id === id && s.enabled);
    if (!service) continue;
    const url = resolveUrl(service).trim();
    if (url) out[id] = url;
  }
  return out;
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; data: unknown }> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      data: body,
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
    return { status: res.status, data };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } finally {
    window.clearTimeout(timer);
  }
}

/** Fetch hub activity summary (streams / downloads / queue / Ombi). */
export async function fetchHubStatusSummary(
  hubBaseUrl: string,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  timeoutMs = 8000,
): Promise<HubStatusSummary | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;

  try {
    const { status, data } = await postJson(
      `${base}/api/status/summary`,
      { urls: summaryUrlMap(services, resolveUrl) },
      timeoutMs,
    );
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      return null;
    }
    return data as HubStatusSummary;
  } catch {
    return null;
  }
}

export async function fetchOmbiPending(
  hubBaseUrl: string,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  timeoutMs = 8000,
): Promise<{
  ok: boolean;
  configured: boolean;
  items: OmbiPendingItem[];
  pending: number;
  error?: string;
} | null> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) return null;

  try {
    const { status, data } = await postJson(
      `${base}/api/activity/ombi/pending`,
      { urls: summaryUrlMap(services, resolveUrl) },
      timeoutMs,
    );
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      return null;
    }
    const json = data as {
      ok?: boolean;
      configured?: boolean;
      items?: OmbiPendingItem[];
      pending?: number;
      error?: string;
    };
    return {
      ok: json.ok !== false,
      configured: json.configured !== false,
      items: Array.isArray(json.items) ? json.items : [],
      pending: typeof json.pending === "number" ? json.pending : 0,
      error: json.error,
    };
  } catch {
    return null;
  }
}

export function issueBadge(issue: ArrQueueIssue): string {
  const state = String(issue.trackedDownloadState || "").toLowerCase();
  const tracked = String(issue.trackedDownloadStatus || "").toLowerCase();
  if (state === "importpending") return "Manual import";
  if (state === "failed" || state === "failedpending") return "Failed";
  if (tracked === "warning") return "Warning";
  if (tracked === "error") return "Error";
  return issue.status || "Stuck";
}

export function ombiTypeLabel(type: OmbiPendingItem["type"]): string {
  if (type === "tv") return "TV";
  if (type === "music") return "Music";
  return "Movie";
}
