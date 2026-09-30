import { Capacitor } from "@capacitor/core";
import { httpRequest, normalizeBase } from "./http";
import type { ServiceConfig } from "./services";

export type DownloadItem = {
  key: string;
  name: string;
  /** 0–100 */
  progress: number;
  state: string;
  speedBps: number;
  etaSeconds: number | null;
  sizeBytes: number;
};

export type DownloadClientState = {
  downloadBps: number;
  uploadBps: number | null;
  paused: boolean;
  /** qBittorrent alternative speed limits / SAB speed limit active. */
  limited: boolean;
  limitLabel: string;
  items: DownloadItem[];
};

// ---------- qBittorrent ----------

const qbitCookies = new Map<string, string>();

function formBody(fields: Record<string, string>): string | Record<string, string> {
  // CapacitorHttp form-encodes objects itself; fetch needs the string.
  if (Capacitor.isNativePlatform()) return fields;
  return new URLSearchParams(fields).toString();
}

export function parseSetCookie(header: string | undefined): string | null {
  if (!header) return null;
  // Cookie name varies (SID, QBT_SID_<port>); take the first name=value pair.
  const m = /^\s*([^=;,\s]+)=([^;,]*)/.exec(header);
  return m ? `${m[1]}=${m[2]}` : null;
}

async function qbitLogin(service: ServiceConfig, base: string): Promise<void> {
  if (!service.username.trim()) return;
  const res = await httpRequest(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: base,
      Origin: base,
    },
    data: formBody({ username: service.username.trim(), password: service.password }),
    timeoutMs: 15000,
  });
  const body = typeof res.data === "string" ? res.data.trim() : "";
  if (res.status === 403) throw new Error("qBittorrent banned this IP after failed logins.");
  if (res.status >= 400 || /^fails/i.test(body)) {
    throw new Error("qBittorrent login failed — check username / password in Settings.");
  }
  const cookie = parseSetCookie(res.headers?.["set-cookie"]);
  if (cookie) qbitCookies.set(base, cookie);
}

async function qbit(
  service: ServiceConfig,
  path: string,
  opts: { method?: string; form?: Record<string, string> } = {},
  retried = false,
): Promise<unknown> {
  const base = normalizeBase(service.url);
  if (!base) throw new Error("qBittorrent URL is not set.");
  if (!qbitCookies.has(base) && service.username.trim() && !retried) {
    await qbitLogin(service, base);
  }
  const headers: Record<string, string> = { Referer: base, Origin: base };
  const cookie = qbitCookies.get(base);
  if (cookie) headers.Cookie = cookie;
  if (opts.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await httpRequest(`${base}${path}`, {
    method: opts.method || (opts.form ? "POST" : "GET"),
    headers,
    data: opts.form ? formBody(opts.form) : undefined,
    timeoutMs: 15000,
  });
  if (res.status === 403 && !retried) {
    qbitCookies.delete(base);
    await qbitLogin(service, base);
    return qbit(service, path, opts, true);
  }
  if (res.status === 404) throw new QbitNotFound(path);
  if (res.status >= 400) throw new Error(`qBittorrent ${path} failed (HTTP ${res.status})`);
  return res.data;
}

class QbitNotFound extends Error {
  constructor(path: string) {
    super(`qBittorrent ${path} not found`);
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const QBIT_PAUSED = new Set(["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]);

export function mapQbitTorrents(data: unknown): DownloadItem[] {
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map((t) => {
      const eta = num(t.eta);
      return {
        key: String(t.hash || t.name),
        name: String(t.name || ""),
        progress: Math.round(num(t.progress) * 1000) / 10,
        state: String(t.state || ""),
        speedBps: num(t.dlspeed),
        etaSeconds: eta > 0 && eta < 8640000 ? eta : null,
        sizeBytes: num(t.size),
      };
    })
    .filter((t) => t.progress < 100 || t.speedBps > 0)
    .sort((a, b) => b.speedBps - a.speedBps || b.progress - a.progress);
}

export async function fetchQbitState(service: ServiceConfig): Promise<DownloadClientState> {
  const [info, mode, torrents] = await Promise.all([
    qbit(service, "/api/v2/transfer/info"),
    qbit(service, "/api/v2/transfer/speedLimitsMode").catch(() => 0),
    qbit(service, "/api/v2/torrents/info?filter=all&sort=dlspeed&reverse=true&limit=200"),
  ]);
  const t = (info && typeof info === "object" ? info : {}) as Record<string, unknown>;
  const items = mapQbitTorrents(torrents);
  const all = Array.isArray(torrents) ? (torrents as Record<string, unknown>[]) : [];
  const incomplete = all.filter((x) => num(x.progress) < 1);
  const limited = String(mode).trim() === "1";
  return {
    downloadBps: num(t.dl_info_speed),
    uploadBps: num(t.up_info_speed),
    paused: incomplete.length > 0 && incomplete.every((x) => QBIT_PAUSED.has(String(x.state))),
    limited,
    limitLabel: limited ? "Alt speed on" : "Alt speed off",
    items,
  };
}

/** qBittorrent 5 renamed pause/resume → stop/start. */
export async function setQbitPaused(service: ServiceConfig, paused: boolean): Promise<void> {
  const [modern, legacy] = paused ? ["stop", "pause"] : ["start", "resume"];
  try {
    await qbit(service, `/api/v2/torrents/${modern}`, { form: { hashes: "all" } });
  } catch (err) {
    if (!(err instanceof QbitNotFound)) throw err;
    await qbit(service, `/api/v2/torrents/${legacy}`, { form: { hashes: "all" } });
  }
}

export async function toggleQbitAltSpeed(service: ServiceConfig): Promise<void> {
  await qbit(service, "/api/v2/transfer/toggleSpeedLimitsMode", { form: {} });
}

// ---------- SABnzbd ----------

async function sab(
  service: ServiceConfig,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const base = normalizeBase(service.url);
  if (!base) throw new Error("SABnzbd URL is not set.");
  const key = service.apiKey.trim();
  if (!key) throw new Error("SABnzbd API key is not set (Settings → SABnzbd).");
  const qs = new URLSearchParams({ ...params, output: "json", apikey: key });
  const res = await httpRequest(`${base}/api?${qs.toString()}`, { timeoutMs: 15000 });
  if (res.status >= 400) throw new Error(`SABnzbd ${params.mode} failed (HTTP ${res.status})`);
  const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
  if (data.status === false || typeof data.error === "string") {
    throw new Error(String(data.error || `SABnzbd ${params.mode} failed`));
  }
  return data;
}

function sabEta(raw: unknown): number | null {
  const parts = String(raw || "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return secs > 0 ? secs : null;
}

export function mapSabQueue(data: Record<string, unknown>): DownloadClientState {
  const q = (data.queue && typeof data.queue === "object" ? data.queue : {}) as Record<
    string,
    unknown
  >;
  const slots = Array.isArray(q.slots) ? (q.slots as Record<string, unknown>[]) : [];
  const kbps = num(q.kbpersec);
  const limitPct = num(q.speedlimit);
  const limited = limitPct > 0 && limitPct < 100;
  return {
    downloadBps: Math.round(kbps * 1024),
    uploadBps: null,
    paused: q.paused === true || String(q.status).toLowerCase() === "paused",
    limited,
    limitLabel: limited ? `Limit ${limitPct}%` : "No limit",
    items: slots.map((s, i) => ({
      key: String(s.nzo_id || i),
      name: String(s.filename || s.name || ""),
      progress: num(s.percentage),
      state: String(s.status || ""),
      speedBps: i === 0 ? Math.round(kbps * 1024) : 0,
      etaSeconds: sabEta(s.timeleft),
      sizeBytes: Math.round(num(s.mb) * 1024 * 1024),
    })),
  };
}

export async function fetchSabState(service: ServiceConfig): Promise<DownloadClientState> {
  return mapSabQueue(await sab(service, { mode: "queue", limit: "50" }));
}

export async function setSabPaused(service: ServiceConfig, paused: boolean): Promise<void> {
  await sab(service, { mode: paused ? "pause" : "resume" });
}

/** Percent of the configured max line speed; 100 clears the limit. */
export async function setSabSpeedLimit(service: ServiceConfig, percent: number): Promise<void> {
  await sab(service, { mode: "config", name: "speedlimit", value: String(percent) });
}

// ---------- shared ----------

export function isDownloadClient(id: string): id is "qbittorrent" | "sabnzbd" {
  return id === "qbittorrent" || id === "sabnzbd";
}

export function fetchDownloadState(service: ServiceConfig): Promise<DownloadClientState> {
  return service.id === "qbittorrent" ? fetchQbitState(service) : fetchSabState(service);
}

export function setDownloadsPaused(service: ServiceConfig, paused: boolean): Promise<void> {
  return service.id === "qbittorrent"
    ? setQbitPaused(service, paused)
    : setSabPaused(service, paused);
}

export function formatSpeed(bps: number): string {
  if (!bps || bps < 1) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let v = bps;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 48) return `${Math.round(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
