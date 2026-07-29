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
  fullTitle: string;
  player: string;
  state: string;
  progressPercent: number;
  transcode: string;
  quality: string;
  thumb?: string;
};

export type TautulliHome = {
  ok: boolean;
  message?: string;
  streamCount: number;
  sessions: TautulliSession[];
};

function asArray(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
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
        sessions: [],
      };
    }
    const payload = res.data as {
      response?: {
        result?: string;
        message?: string;
        data?: {
          stream_count?: number | string;
          sessions?: Record<string, unknown>[];
        };
      };
    };
    if (payload?.response?.result !== "success") {
      return {
        ok: false,
        message: payload?.response?.message || "Tautulli request failed",
        streamCount: 0,
        sessions: [],
      };
    }
    const data = payload.response.data ?? {};
    const sessions = asArray(data.sessions).map((row) => {
      const progress = Number(row.progress_percent ?? row.progress ?? 0);
      return {
        sessionKey: String(row.session_key ?? row.session_id ?? Math.random()),
        user: String(row.friendly_name || row.username || "User"),
        title: String(row.title || row.grandparent_title || "Playback"),
        fullTitle: String(
          row.full_title ||
            [row.grandparent_title, row.parent_title, row.title]
              .filter(Boolean)
              .join(" · ") ||
            row.title ||
            "Playback",
        ),
        player: String(row.player || row.product || "Player"),
        state: String(row.state || "playing"),
        progressPercent: Number.isFinite(progress) ? progress : 0,
        transcode: String(
          row.transcode_decision || row.video_decision || "direct",
        ),
        quality: String(row.quality_profile || row.stream_video_full_resolution || ""),
        thumb: row.thumb ? String(row.thumb) : undefined,
      } as TautulliSession;
    });

    return {
      ok: true,
      streamCount: Number(data.stream_count ?? sessions.length) || sessions.length,
      sessions,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      streamCount: 0,
      sessions: [],
    };
  }
}
