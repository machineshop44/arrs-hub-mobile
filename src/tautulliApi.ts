import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { ServiceConfig } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function httpGet(url: string, timeoutMs = 12000) {
  if (Capacitor.isNativePlatform()) {
    return CapacitorHttp.get({
      url,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export type TautulliSession = {
  sessionKey: string;
  user: string;
  title: string;
  /** Show / movie / album headline (grandparent or title). */
  displayTitle: string;
  /** Season · Episode: name, year, or track line. */
  subtitle: string;
  fullTitle: string;
  player: string;
  product: string;
  platform: string;
  device: string;
  location: string;
  mediaType: string;
  state: string;
  progressPercent: number;
  transcodeProgress: number;
  /** Raw decision string from Tautulli (direct play / copy / transcode). */
  transcode: string;
  /** Normalized label for UI. */
  transcodeLabel: string;
  quality: string;
  resolution: string;
  bandwidthKbps: number;
  year?: string;
  posterUrl?: string;
  userThumbUrl?: string;
};

export type TautulliHome = {
  ok: boolean;
  message?: string;
  streamCount: number;
  totalBandwidthKbps: number;
  sessions: TautulliSession[];
};

function asArray(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const n = Number(row[key]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Map Tautulli decision strings to a short official-style label. */
export function formatTranscodeLabel(raw: string): string {
  const d = raw.trim().toLowerCase();
  if (!d) return "Unknown";
  if (d.includes("transcode")) return "Transcode";
  if (d === "copy" || d.includes("direct stream") || d === "directstream") {
    return "Direct Stream";
  }
  if (d.includes("direct")) return "Direct Play";
  return raw
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function formatBandwidth(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return "";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

/**
 * Build a Tautulli pms_image_proxy URL. Paths like `/library/metadata/.../thumb/...`
 * must go through the proxy; absolute http(s) URLs (e.g. plex.tv avatars) pass through.
 */
export function tautulliImageUrl(
  service: ServiceConfig,
  opts: {
    img?: string;
    ratingKey?: string;
    width?: number;
    height?: number;
    fallback?: "poster" | "cover" | "art" | "user";
  },
): string | undefined {
  const base = normalizeBase(service.url);
  const key = service.apiKey.trim();
  if (!base || !key) return undefined;

  const img = String(opts.img || "").trim();
  if (/^https?:\/\//i.test(img)) return img;

  const params = new URLSearchParams({
    apikey: key,
    cmd: "pms_image_proxy",
    width: String(opts.width ?? 300),
    height: String(opts.height ?? 450),
    fallback: opts.fallback ?? "poster",
  });

  if (opts.ratingKey) {
    params.set("rating_key", String(opts.ratingKey));
  } else if (img) {
    params.set("img", img);
  } else {
    return undefined;
  }

  return `${base}/api/v2?${params.toString()}`;
}

function episodeSubtitle(row: Record<string, unknown>): string {
  const season = str(row, "parent_media_index", "parent_title");
  const ep = str(row, "media_index");
  const epTitle = str(row, "title");
  const seasonLabel = /^\d+$/.test(season)
    ? `S${season.padStart(2, "0")}`
    : season || "";
  const epLabel = ep ? `E${ep.padStart(2, "0")}` : "";
  const index =
    seasonLabel && epLabel
      ? `${seasonLabel} · ${epLabel}`
      : seasonLabel || epLabel;
  if (index && epTitle) return `${index}: ${epTitle}`;
  if (index) return index;
  return epTitle;
}

function mapSession(
  service: ServiceConfig,
  row: Record<string, unknown>,
): TautulliSession {
  const mediaType = str(row, "media_type").toLowerCase() || "unknown";
  const progress = num(row, "progress_percent", "progress");
  const transcodeRaw = str(
    row,
    "transcode_decision",
    "video_decision",
    "stream_video_decision",
  );
  const year = str(row, "year");
  const grandparent = str(row, "grandparent_title");
  const parent = str(row, "parent_title");
  const title = str(row, "title") || "Playback";

  let displayTitle = title;
  let subtitle = "";
  if (mediaType === "episode") {
    displayTitle = grandparent || title;
    subtitle = episodeSubtitle(row);
  } else if (mediaType === "movie") {
    displayTitle = title;
    subtitle = year;
  } else if (mediaType === "track") {
    displayTitle = grandparent || parent || title;
    subtitle = [parent, title].filter(Boolean).join(" — ");
  } else if (mediaType === "live") {
    displayTitle = title;
    subtitle = str(row, "channel_call_sign", "parent_title");
  } else {
    displayTitle = grandparent || title;
    subtitle = [parent, year].filter(Boolean).join(" · ");
  }

  const fullTitle =
    str(row, "full_title") ||
    [grandparent, parent, title].filter(Boolean).join(" · ") ||
    title;

  // Prefer show/movie poster rating keys (LunaSea / official app behavior).
  let ratingKey = str(row, "rating_key");
  let thumbPath = str(row, "thumb");
  if (mediaType === "episode") {
    ratingKey = str(row, "grandparent_rating_key") || ratingKey;
    thumbPath = str(row, "grandparent_thumb") || thumbPath;
  } else if (mediaType === "track") {
    ratingKey = str(row, "parent_rating_key") || ratingKey;
    thumbPath = str(row, "parent_thumb") || thumbPath;
  }

  const posterUrl =
    tautulliImageUrl(service, {
      ratingKey: ratingKey || undefined,
      img: thumbPath || undefined,
      width: 300,
      height: 450,
      fallback: mediaType === "track" ? "cover" : "poster",
    }) || undefined;

  const userThumbRaw = str(row, "user_thumb");
  // user_thumb is usually a plex.tv https URL; otherwise proxy via Tautulli.
  const userThumbUrl = userThumbRaw
    ? /^https?:\/\//i.test(userThumbRaw)
      ? userThumbRaw
      : tautulliImageUrl(service, {
          img: userThumbRaw,
          width: 80,
          height: 80,
          fallback: "user",
        })
    : undefined;

  return {
    sessionKey: str(row, "session_key", "session_id") || String(Math.random()),
    user: str(row, "friendly_name", "username", "user") || "User",
    title,
    displayTitle,
    subtitle,
    fullTitle,
    player: str(row, "player") || "Player",
    product: str(row, "product"),
    platform: str(row, "platform", "platform_name"),
    device: str(row, "device"),
    location: str(row, "location"),
    mediaType,
    state: str(row, "state") || "playing",
    progressPercent: Number.isFinite(progress) ? progress : 0,
    transcodeProgress: num(row, "transcode_progress"),
    transcode: transcodeRaw || "direct play",
    transcodeLabel: formatTranscodeLabel(transcodeRaw || "direct play"),
    quality: str(row, "quality_profile"),
    resolution: str(
      row,
      "stream_video_full_resolution",
      "video_full_resolution",
      "stream_video_resolution",
    ),
    bandwidthKbps: num(row, "bandwidth"),
    year: year || undefined,
    posterUrl,
    userThumbUrl: userThumbUrl || undefined,
  };
}

export async function fetchTautulliActivity(
  service: ServiceConfig,
): Promise<TautulliHome> {
  const base = normalizeBase(service.url);
  const key = service.apiKey.trim();
  if (!key) {
    return {
      ok: false,
      message: "Add your Tautulli API key in Settings.",
      streamCount: 0,
      totalBandwidthKbps: 0,
      sessions: [],
    };
  }

  const url = `${base}/api/v2?apikey=${encodeURIComponent(key)}&cmd=get_activity`;
  try {
    const res = await httpGet(url);
    if (res.status >= 400) {
      return {
        ok: false,
        message: `Tautulli HTTP ${res.status}`,
        streamCount: 0,
        totalBandwidthKbps: 0,
        sessions: [],
      };
    }
    const payload = res.data as {
      response?: {
        result?: string;
        message?: string;
        data?: {
          stream_count?: number | string;
          total_bandwidth?: number | string;
          sessions?: Record<string, unknown>[];
        };
      };
    };
    if (payload?.response?.result !== "success") {
      return {
        ok: false,
        message: payload?.response?.message || "Tautulli request failed",
        streamCount: 0,
        totalBandwidthKbps: 0,
        sessions: [],
      };
    }
    const data = payload.response.data ?? {};
    const sessions = asArray(data.sessions).map((row) =>
      mapSession(service, row),
    );

    return {
      ok: true,
      streamCount:
        Number(data.stream_count ?? sessions.length) || sessions.length,
      totalBandwidthKbps: Number(data.total_bandwidth ?? 0) || 0,
      sessions,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      streamCount: 0,
      totalBandwidthKbps: 0,
      sessions: [],
    };
  }
}
