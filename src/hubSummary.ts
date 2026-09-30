import { hubPostJson, normalizeBase } from "./http";
import { statusUrlMap } from "./chipVersions";
import {
  HubAuthError,
  isHubAuthFailure,
} from "./hubAuth";
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
    readarr?: ArrQueueApp;
    whisparr?: ArrQueueApp;
  };
};

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
    const { status, data } = await hubPostJson(
      `${base}/api/status/summary`,
      { urls: statusUrlMap(services, resolveUrl) },
      timeoutMs,
    );
    if (isHubAuthFailure(status)) throw new HubAuthError(status);
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      return null;
    }
    return data as HubStatusSummary;
  } catch (err) {
    if (err instanceof HubAuthError) throw err;
    console.warn(
      "[hubSummary] summary fetch failed:",
      err instanceof Error ? err.message : err,
    );
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
    const { status, data } = await hubPostJson(
      `${base}/api/activity/ombi/pending`,
      { urls: statusUrlMap(services, resolveUrl) },
      timeoutMs,
    );
    if (isHubAuthFailure(status)) {
      return {
        ok: false,
        configured: true,
        items: [],
        pending: 0,
        error: new HubAuthError(status).message,
      };
    }
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
  } catch (err) {
    if (err instanceof HubAuthError) {
      return {
        ok: false,
        configured: true,
        items: [],
        pending: 0,
        error: err.message,
      };
    }
    return null;
  }
}

async function postOmbiAction(
  hubBaseUrl: string,
  action: "approve" | "deny",
  body: Record<string, unknown>,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  timeoutMs: number,
): Promise<{ status: number; error: string }> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) throw new Error("Hub URL is not set");
  const label = action === "approve" ? "Approve" : "Deny";

  let status: number;
  let data: unknown;
  try {
    ({ status, data } = await hubPostJson(
      `${base}/api/activity/ombi/${action}`,
      { ...body, urls: statusUrlMap(services, resolveUrl) },
      timeoutMs,
    ));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) {
      throw new Error(`${label} timed out talking to hub`);
    }
    throw new Error(msg || `${label} network error`);
  }

  const error =
    data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error || "").trim()
      : "";
  if (isHubAuthFailure(status)) throw new HubAuthError(status);
  return { status, error };
}

/** Approve an Ombi request via hub (mirrors DashboardStatus approve body). */
export async function approveOmbiRequest(
  hubBaseUrl: string,
  item: Pick<OmbiPendingItem, "type" | "id">,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  timeoutMs = 15000,
): Promise<void> {
  const { status, error } = await postOmbiAction(
    hubBaseUrl,
    "approve",
    { type: item.type, id: item.id },
    services,
    resolveUrl,
    timeoutMs,
  );
  if (status < 200 || status >= 300) {
    throw new Error(error || `Approve failed (HTTP ${status})`);
  }
}

/**
 * Deny via hub so the phone doesn't need Ombi's key. Returns false when the
 * hub is too old to have the route (caller falls back to direct Ombi).
 */
export async function denyOmbiRequestViaHub(
  hubBaseUrl: string,
  item: Pick<OmbiPendingItem, "type" | "id">,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
  reason = "",
  timeoutMs = 15000,
): Promise<boolean> {
  const { status, error } = await postOmbiAction(
    hubBaseUrl,
    "deny",
    { type: item.type, id: item.id, reason: reason.trim() || undefined },
    services,
    resolveUrl,
    timeoutMs,
  );
  if (status === 404 || status === 405) return false;
  if (status < 200 || status >= 300) {
    throw new Error(error || `Deny failed (HTTP ${status})`);
  }
  return true;
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
