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

async function workoutsGet(hubUrl: string, path: string) {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Add it under Workouts (or Wake-on-LAN → Arrs Hub URL) in Settings.",
    );
  }
  const res = await httpRequest(`${base}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeoutMs: 15000,
  });
  const json = asObject(res.data);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      String(json.error || `Hub returned HTTP ${res.status}. Is Arrs Hub online?`),
    );
  }
  return json;
}

async function workoutsPost(hubUrl: string, path: string, body: unknown) {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Add it under Workouts (or Wake-on-LAN → Arrs Hub URL) in Settings.",
    );
  }
  const res = await httpRequest(`${base}${path}`, {
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
      String(json.error || `Hub returned HTTP ${res.status}. Is Arrs Hub online?`),
    );
  }
  return json;
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

export async function checkHubReachable(hubUrl: string): Promise<boolean> {
  const base = normalizeBase(hubUrl);
  if (!base) return false;
  try {
    const res = await httpRequest(`${base}/api/health`, {
      method: "GET",
      timeoutMs: 8000,
    });
    if (res.status >= 200 && res.status < 500) return true;
  } catch {
    // fall through to workouts settings probe
  }
  try {
    const res = await httpRequest(`${base}/api/workouts/settings`, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: 8000,
    });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
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
    return {
      name: String(c.name || "Client"),
      address: String(c.address || ""),
      port: Number(c.port) || 0,
      machineIdentifier: String(c.machineIdentifier || ""),
      product: c.product ? String(c.product) : undefined,
      castType: c.castType ? String(c.castType) : undefined,
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
        url: String(item.url || ""),
        seekable: item.seekable !== false,
        durationMs:
          typeof item.durationMs === "number" ? item.durationMs : null,
      };
    }),
    playQueueID:
      typeof json.playQueueID === "number" ? json.playQueueID : undefined,
  };
}
