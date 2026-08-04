import { httpRequest } from "./arrApi";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function asObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data === "string" && data.trim()) {
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // keep empty
    }
  }
  return {};
}

function formatHubHttpError(
  url: string,
  status: number,
  json: Record<string, unknown>,
  fallback: string,
): string {
  const detail =
    typeof json.error === "string" && json.error.trim()
      ? json.error.trim()
      : fallback;
  return `${detail}\nTried: ${url}${status ? ` (HTTP ${status})` : ""}`;
}

async function workoutsGet(hubUrl: string, path: string) {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Add it under Settings → Network (Arrs Hub host + port) or Workouts.",
    );
  }
  const url = `${base}${path}`;
  try {
    const res = await httpRequest(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: 15000,
    });
    const json = asObject(res.data);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        formatHubHttpError(
          url,
          res.status,
          json,
          `Hub returned HTTP ${res.status}. Is Arrs Hub online?`,
        ),
      );
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Tried:")) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\nTried: ${url}`);
  }
}

async function workoutsPost(hubUrl: string, path: string, body: unknown) {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Add it under Settings → Network (Arrs Hub host + port) or Workouts.",
    );
  }
  const url = `${base}${path}`;
  try {
    const res = await httpRequest(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      data: body,
      timeoutMs: 30000,
    });
    const json = asObject(res.data);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        formatHubHttpError(
          url,
          res.status,
          json,
          `Hub returned HTTP ${res.status}. Is Arrs Hub online?`,
        ),
      );
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Tried:")) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\nTried: ${url}`);
  }
}

export type WorkoutSettings = {
  plexBaseUrl: string;
  plexToken: string;
  plexTokenSet?: boolean;
  plexUsername?: string;
  librarySectionId: string;
  matchMode: "episode" | "title";
  showTitle: string;
  seasonNumber: number;
  warmupEpisode: number;
  firstDayEpisode: number;
  warmupTitle: string;
  dayTitlePattern: string;
  clientMachineId: string;
  clientName: string;
  dayCount: number;
};

export type WorkoutClient = {
  name: string;
  address: string;
  port: number;
  machineIdentifier: string;
  product?: string;
  castType?: string;
  deviceClass?: string;
  platform?: string;
  provides?: string;
  kind?: "local" | "tv" | "speaker" | "phone" | "app";
  kindLabel?: string;
};

export type WorkoutDay = {
  day: number;
  title: string;
  ratingKey: string;
  episode?: number;
};

export type WorkoutWarmup = {
  title: string;
  ratingKey: string;
  episode?: number;
};

export type WorkoutDiscover = {
  ok: boolean;
  warmup: WorkoutWarmup | null;
  days: WorkoutDay[];
  itemCount?: number;
  hint?: string;
  matchMode?: string;
  showTitle?: string;
};

export type PlaylistItem = {
  title: string;
  ratingKey: string;
  url: string;
  seekable?: boolean;
  durationMs?: number | null;
};

export type PlayResult = {
  ok: boolean;
  mode: "local" | "cast" | "client";
  client: string;
  warmup: string;
  day: string;
  playlist?: PlaylistItem[];
  playQueueID?: number;
};

export const LOCAL_CLIENT_ID = "arrs-hub-local";

export type HubReachability = {
  ok: boolean;
  triedUrl: string;
  detail: string;
};

/** Probe hub health (then workouts settings). Always reports the URL tried. */
export async function probeHubReachable(
  hubUrl: string,
): Promise<HubReachability> {
  const base = normalizeBase(hubUrl);
  if (!base) {
    return {
      ok: false,
      triedUrl: "",
      detail:
        "Arrs Hub URL is not set. Open Settings → Network and set host + port 3000.",
    };
  }

  const healthUrl = `${base}/api/health`;
  try {
    const res = await httpRequest(healthUrl, {
      method: "GET",
      timeoutMs: 8000,
    });
    if (res.status >= 200 && res.status < 500) {
      return {
        ok: true,
        triedUrl: healthUrl,
        detail: `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // try settings next, but keep health failure for final message
    try {
      const settingsUrl = `${base}/api/workouts/settings`;
      const res = await httpRequest(settingsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        timeoutMs: 8000,
      });
      if (res.status >= 200 && res.status < 500) {
        return {
          ok: true,
          triedUrl: settingsUrl,
          detail: `HTTP ${res.status} (via workouts settings)`,
        };
      }
      return {
        ok: false,
        triedUrl: settingsUrl,
        detail: `HTTP ${res.status} after health failed: ${reason}`,
      };
    } catch (err2) {
      const reason2 = err2 instanceof Error ? err2.message : String(err2);
      return {
        ok: false,
        triedUrl: healthUrl,
        detail: `${reason} · settings: ${reason2}`,
      };
    }
  }

  try {
    const settingsUrl = `${base}/api/workouts/settings`;
    const res = await httpRequest(settingsUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: 8000,
    });
    if (res.status >= 200 && res.status < 500) {
      return {
        ok: true,
        triedUrl: settingsUrl,
        detail: `HTTP ${res.status}`,
      };
    }
    return {
      ok: false,
      triedUrl: settingsUrl,
      detail: `HTTP ${res.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, triedUrl: healthUrl, detail: reason };
  }
}

export async function checkHubReachable(hubUrl: string): Promise<boolean> {
  return (await probeHubReachable(hubUrl)).ok;
}

export async function fetchWorkoutSettings(
  hubUrl: string,
): Promise<WorkoutSettings> {
  const json = await workoutsGet(hubUrl, "/api/workouts/settings");
  const loaded = asObject(json.settings) as Partial<WorkoutSettings>;
  return {
    plexBaseUrl: loaded.plexBaseUrl || "",
    plexToken: loaded.plexToken || "",
    plexTokenSet: Boolean(loaded.plexTokenSet),
    plexUsername: loaded.plexUsername || "",
    librarySectionId: loaded.librarySectionId || "",
    matchMode: loaded.matchMode === "title" ? "title" : "episode",
    showTitle: loaded.showTitle || "Fit With the Force",
    seasonNumber: loaded.seasonNumber ?? 1,
    warmupEpisode: loaded.warmupEpisode ?? 2,
    firstDayEpisode: loaded.firstDayEpisode ?? 3,
    warmupTitle: loaded.warmupTitle || "Warm Up",
    dayTitlePattern: loaded.dayTitlePattern || "Day {n}",
    clientMachineId: loaded.clientMachineId || LOCAL_CLIENT_ID,
    clientName: loaded.clientName || "This device (play here)",
    dayCount: loaded.dayCount || 30,
  };
}

export async function fetchWorkoutClients(
  hubUrl: string,
): Promise<WorkoutClient[]> {
  const json = await workoutsGet(hubUrl, "/api/workouts/clients");
  const list = Array.isArray(json.clients) ? json.clients : [];
  return list.map((raw) => {
    const c = asObject(raw);
    const kindRaw = String(c.kind || "");
    const kind =
      kindRaw === "tv" ||
      kindRaw === "speaker" ||
      kindRaw === "phone" ||
      kindRaw === "app" ||
      kindRaw === "local"
        ? kindRaw
        : undefined;
    return {
      name: String(c.name || "Client"),
      address: String(c.address || ""),
      port: Number(c.port) || 0,
      machineIdentifier: String(c.machineIdentifier || ""),
      product: c.product ? String(c.product) : undefined,
      castType: c.castType ? String(c.castType) : undefined,
      deviceClass: c.deviceClass ? String(c.deviceClass) : undefined,
      platform: c.platform ? String(c.platform) : undefined,
      provides: c.provides ? String(c.provides) : undefined,
      kind,
      kindLabel: c.kindLabel ? String(c.kindLabel) : undefined,
    };
  });
}

export async function fetchWorkoutDiscover(
  hubUrl: string,
): Promise<WorkoutDiscover> {
  const json = await workoutsGet(hubUrl, "/api/workouts/discover");
  const warmupRaw = json.warmup ? asObject(json.warmup) : null;
  const daysRaw = Array.isArray(json.days) ? json.days : [];
  return {
    ok: json.ok !== false,
    warmup: warmupRaw
      ? {
          title: String(warmupRaw.title || "Warm Up"),
          ratingKey: String(warmupRaw.ratingKey || ""),
          episode:
            typeof warmupRaw.episode === "number"
              ? warmupRaw.episode
              : undefined,
        }
      : null,
    days: daysRaw.map((raw) => {
      const d = asObject(raw);
      return {
        day: Number(d.day) || 0,
        title: String(d.title || ""),
        ratingKey: String(d.ratingKey || ""),
        episode: typeof d.episode === "number" ? d.episode : undefined,
      };
    }),
    itemCount: typeof json.itemCount === "number" ? json.itemCount : undefined,
    hint: json.hint ? String(json.hint) : undefined,
    matchMode: json.matchMode ? String(json.matchMode) : undefined,
    showTitle: json.showTitle ? String(json.showTitle) : undefined,
  };
}

export async function playWorkoutDay(
  hubUrl: string,
  day: number,
  clientMachineId: string,
): Promise<PlayResult> {
  const json = await workoutsPost(hubUrl, "/api/workouts/play", {
    day,
    clientMachineId,
  });
  const mode =
    json.mode === "cast" || json.mode === "client" || json.mode === "local"
      ? json.mode
      : "client";
  const playlistRaw = Array.isArray(json.playlist) ? json.playlist : undefined;
  return {
    ok: json.ok !== false,
    mode,
    client: String(json.client || "device"),
    warmup: String(json.warmup || "Warm-up"),
    day: String(json.day || `Day ${day}`),
    playlist: playlistRaw?.map((raw) => {
      const item = asObject(raw);
      return {
        title: String(item.title || ""),
        ratingKey: String(item.ratingKey || ""),
        url: resolvePlaylistUrl(hubUrl, item),
        seekable: item.seekable !== false,
        durationMs:
          typeof item.durationMs === "number" ? item.durationMs : null,
      };
    }),
    playQueueID:
      typeof json.playQueueID === "number" ? json.playQueueID : undefined,
  };
}

/**
 * Ensure playlist media is fetched via the hub proxy (never Plex localhost).
 */
function resolvePlaylistUrl(
  hubUrl: string,
  item: Record<string, unknown>,
): string {
  const ratingKey = String(item.ratingKey || "").trim();
  const raw = String(item.url || "").trim();
  const base = normalizeBase(hubUrl);
  const proxyPath = ratingKey
    ? `/api/workouts/media/${encodeURIComponent(ratingKey)}`
    : "";

  if (raw.includes("/api/workouts/media/")) {
    try {
      // Absolute hub URL already — keep it if host isn't loopback-only dead end
      const u = new URL(raw, base || "http://local.invalid");
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        return base && proxyPath ? `${base}${proxyPath}` : raw;
      }
      return u.toString();
    } catch {
      return base && proxyPath ? `${base}${proxyPath}` : raw;
    }
  }

  // Legacy: direct Plex part URL (often localhost:32400) — rewrite to hub proxy.
  if (ratingKey && base) {
    try {
      const u = new URL(raw);
      if (
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.pathname.includes("/library/parts/") ||
        u.pathname.includes("/video/:/transcode/")
      ) {
        return `${base}${proxyPath}`;
      }
    } catch {
      return `${base}${proxyPath}`;
    }
  }

  if (raw.startsWith("/") && base) return `${base}${raw}`;
  return raw || (base && proxyPath ? `${base}${proxyPath}` : "");
}
