import { httpRequest } from "./arrApi";
import type { ServiceConfig } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function ytarrHeaders(service: ServiceConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (service.apiKey.trim()) {
    headers["X-Api-Key"] = service.apiKey.trim();
  }
  return headers;
}

async function ytarrRequest(
  service: ServiceConfig,
  apiPath: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    data?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; data: unknown; latencyMs: number }> {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const qs = new URLSearchParams();
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return httpRequest(`${base}${path}${suffix}`, {
    method: options.method || "GET",
    headers: ytarrHeaders(service),
    data: options.data,
    timeoutMs: options.timeoutMs ?? 30000,
  });
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail != null) return JSON.stringify(detail);
  }
  if (typeof data === "string" && data.trim()) return data;
  return fallback;
}

async function parseOk<T>(
  res: { status: number; data: unknown },
  fallback: string,
): Promise<T> {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(errorMessage(res.data, fallback));
  }
  return res.data as T;
}

export type YtarrSource = {
  id: number;
  url: string;
  title: string;
  yt_id: string | null;
  source_type: string;
  enabled: boolean;
  monitor_mode: string;
  quality: string;
  media_type: string;
  folder_name: string;
  last_checked: string | null;
  initialized: boolean;
  video_count: number;
  wanted_count: number;
  downloaded_count: number;
};

export type YtarrVideo = {
  id: number;
  source_id: number;
  video_id: string;
  title: string;
  published_at: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  file_path: string | null;
  status: string;
  error: string | null;
  source_title: string | null;
};

export type YtarrDownloadJob = {
  id: number;
  video_id: number;
  progress: number;
  status: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  video_title: string | null;
  youtube_id: string | null;
  source_title: string | null;
};

export type YtarrDashboard = {
  sources: number;
  enabled_sources: number;
  videos: number;
  wanted: number;
  downloading: number;
  downloaded: number;
  failed: number;
  queue_size: number;
  ytdlp_ok: boolean;
  ytdlp_version: string | null;
};

export type YtarrHealth = {
  status: string;
  ytdlp_ok: boolean;
  ytdlp_version: string | null;
  ytdlp_error: string | null;
  library_root: string;
  library_exists: boolean;
};

export type YtarrSearchHit = {
  kind: string;
  title: string;
  url: string;
  id: string | null;
  channel: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  description: string | null;
  video_count?: number | null;
};

export function posterUrl(service: ServiceConfig, sourceId: number): string {
  const base = normalizeBase(service.url);
  const key = service.apiKey.trim();
  const qs = key ? `?apikey=${encodeURIComponent(key)}` : "";
  return `${base}/api/sources/${sourceId}/poster${qs}`;
}

export async function fetchYtarrHealth(service: ServiceConfig): Promise<YtarrHealth> {
  const res = await ytarrRequest(service, "/api/health", { timeoutMs: 10000 });
  return parseOk(res, `Health failed (HTTP ${res.status})`);
}

export async function fetchYtarrDashboard(
  service: ServiceConfig,
): Promise<YtarrDashboard> {
  const res = await ytarrRequest(service, "/api/dashboard");
  return parseOk(res, `Dashboard failed (HTTP ${res.status})`);
}

export async function fetchYtarrSources(
  service: ServiceConfig,
): Promise<YtarrSource[]> {
  const res = await ytarrRequest(service, "/api/sources");
  const data = await parseOk<YtarrSource[]>(
    res,
    `Sources failed (HTTP ${res.status})`,
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchYtarrVideos(
  service: ServiceConfig,
  params?: { status?: string; source_id?: number; limit?: number },
): Promise<YtarrVideo[]> {
  const res = await ytarrRequest(service, "/api/videos", { query: params });
  const data = await parseOk<YtarrVideo[]>(
    res,
    `Videos failed (HTTP ${res.status})`,
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchYtarrQueue(
  service: ServiceConfig,
  params?: { status?: string; limit?: number; source_id?: number },
): Promise<YtarrDownloadJob[]> {
  const res = await ytarrRequest(service, "/api/queue", { query: params });
  const data = await parseOk<YtarrDownloadJob[]>(
    res,
    `Queue failed (HTTP ${res.status})`,
  );
  return Array.isArray(data) ? data : [];
}

export async function searchYtarr(
  service: ServiceConfig,
  q: string,
  kind: "channel" | "playlist" | "video" = "channel",
  limit = 12,
): Promise<YtarrSearchHit[]> {
  const res = await ytarrRequest(service, "/api/search", {
    query: { q, kind, limit },
    timeoutMs: 60000,
  });
  const data = await parseOk<{ results?: YtarrSearchHit[] }>(
    res,
    `Search failed (HTTP ${res.status})`,
  );
  return Array.isArray(data.results) ? data.results : [];
}

export async function addYtarrSource(
  service: ServiceConfig,
  url: string,
  mode: "new" | "all" | "video" | "none" = "all",
  opts?: {
    quality?: string;
    media_type?: "video" | "audio";
    title?: string | null;
    yt_id?: string | null;
    thumbnail_url?: string | null;
    channel?: string | null;
  },
): Promise<YtarrSource> {
  const res = await ytarrRequest(service, "/api/sources", {
    method: "POST",
    data: {
      url,
      mode,
      quality: opts?.quality ?? "",
      media_type: opts?.media_type ?? "video",
      ...(opts?.title ? { title: opts.title } : {}),
      ...(opts?.yt_id ? { yt_id: opts.yt_id } : {}),
      ...(opts?.thumbnail_url ? { thumbnail_url: opts.thumbnail_url } : {}),
      ...(opts?.channel ? { channel: opts.channel } : {}),
    },
    timeoutMs: 120000,
  });
  return parseOk(res, `Add channel failed (HTTP ${res.status})`);
}

export async function patchYtarrSource(
  service: ServiceConfig,
  id: number,
  body: {
    enabled?: boolean;
    title?: string;
    monitor_mode?: string;
    quality?: string;
    media_type?: string;
  },
): Promise<YtarrSource> {
  const res = await ytarrRequest(service, `/api/sources/${id}`, {
    method: "PATCH",
    data: body,
  });
  return parseOk(res, `Update failed (HTTP ${res.status})`);
}

export async function checkYtarrSource(
  service: ServiceConfig,
  id: number,
): Promise<Record<string, unknown>> {
  const res = await ytarrRequest(service, `/api/sources/${id}/check`, {
    method: "POST",
    timeoutMs: 120000,
  });
  return parseOk(res, `Refresh failed (HTTP ${res.status})`);
}

export async function checkAllYtarrSources(
  service: ServiceConfig,
): Promise<{ ok: boolean; checked: number }> {
  const res = await ytarrRequest(service, "/api/sources/check-all", {
    method: "POST",
    timeoutMs: 180000,
  });
  return parseOk(res, `Scan all failed (HTTP ${res.status})`);
}

export async function backfillYtarrSource(
  service: ServiceConfig,
  id: number,
): Promise<Record<string, unknown>> {
  const res = await ytarrRequest(service, `/api/sources/${id}/backfill`, {
    method: "POST",
    timeoutMs: 180000,
  });
  return parseOk(res, `Backfill failed (HTTP ${res.status})`);
}

export async function retryYtarrVideo(
  service: ServiceConfig,
  id: number,
): Promise<YtarrVideo> {
  const res = await ytarrRequest(service, `/api/videos/${id}/retry`, {
    method: "POST",
  });
  return parseOk(res, `Retry failed (HTTP ${res.status})`);
}

export async function ignoreYtarrVideo(
  service: ServiceConfig,
  id: number,
): Promise<YtarrVideo> {
  const res = await ytarrRequest(service, `/api/videos/${id}/ignore`, {
    method: "POST",
  });
  return parseOk(res, `Ignore failed (HTTP ${res.status})`);
}

export async function pauseYtarrQueue(service: ServiceConfig): Promise<void> {
  const res = await ytarrRequest(service, "/api/queue/pause", {
    method: "POST",
  });
  await parseOk(res, `Pause failed (HTTP ${res.status})`);
}

export async function resumeYtarrQueue(service: ServiceConfig): Promise<void> {
  const res = await ytarrRequest(service, "/api/queue/resume", {
    method: "POST",
  });
  await parseOk(res, `Resume failed (HTTP ${res.status})`);
}

export async function processYtarrQueue(service: ServiceConfig): Promise<void> {
  const res = await ytarrRequest(service, "/api/queue/process", {
    method: "POST",
  });
  await parseOk(res, `Process failed (HTTP ${res.status})`);
}

export async function cancelYtarrQueueJob(
  service: ServiceConfig,
  id: number,
): Promise<YtarrDownloadJob> {
  const res = await ytarrRequest(service, `/api/queue/${id}/cancel`, {
    method: "POST",
  });
  return parseOk(res, `Cancel failed (HTTP ${res.status})`);
}

export async function retryYtarrQueueJob(
  service: ServiceConfig,
  id: number,
): Promise<YtarrDownloadJob> {
  const res = await ytarrRequest(service, `/api/queue/${id}/retry`, {
    method: "POST",
  });
  return parseOk(res, `Retry failed (HTTP ${res.status})`);
}

export function formatDurationSeconds(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatVideoStatus(status: string): string {
  switch (status) {
    case "downloaded":
      return "Downloaded";
    case "wanted":
      return "Wanted";
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "failed":
      return "Failed";
    case "ignored":
      return "Ignored";
    default:
      return status;
  }
}
