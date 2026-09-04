import type { ServiceConfig } from "./services";
import { isCompanionOnlyUrl } from "./services";

export type PcWatchSummary = {
  id: string;
  name: string;
  host: string;
  companionUrl?: string;
  companionId?: string;
};

export type WatchServiceSummary = {
  restartPcId?: string;
  monitor?: boolean;
};

export type CompanionAppStatus = {
  id: string;
  label: string;
  up: boolean | null;
  message?: string;
  openUrl: string | null;
};

export type CompanionPcStatus = {
  pc: PcWatchSummary;
  online: boolean | null;
  message?: string;
  apps: CompanionAppStatus[];
};

export type CompanionChipTone = "good" | "bad" | "warn" | "muted";

const COMPANION_FALLBACK_IDS = [
  "qbittorrent",
  "sabnzbd",
  "fileflows-node",
] as const;

export const COMPANION_APP_ORDER = [
  "qbittorrent",
  "sabnzbd",
  "fileflows-node",
  "fileflows",
  "surfshark",
] as const;

function healthLabel(up: boolean | null): string {
  if (up === true) return "up";
  if (up === false) return "down";
  return "…";
}

function openUrlForService(
  service: ServiceConfig,
  resolveUrl: (service: ServiceConfig) => string,
): string | null {
  const url = resolveUrl(service).trim();
  if (!url || isCompanionOnlyUrl(url)) return null;
  return url;
}

/** Prefer a Companion-registered downloader PC (URL, then companion id).
 * When several exist, prefer one currently reported online. */
export function pickCompanionPc(
  pcConfigs: PcWatchSummary[],
  pcs: Record<string, { online: boolean | null; message?: string }> = {},
): PcWatchSummary | null {
  const withUrl = pcConfigs.filter((item) =>
    String(item.companionUrl || "").trim(),
  );
  const withId = pcConfigs.filter((item) =>
    String(item.companionId || "").trim(),
  );
  const pool = withUrl.length > 0 ? withUrl : withId;
  if (pool.length === 0) return null;
  const online = pool.find((item) => pcs[item.id]?.online === true);
  return online || pool[0] || null;
}

export function buildCompanionPcStatus(
  pcConfigs: PcWatchSummary[],
  pcs: Record<string, { online: boolean | null; message?: string }>,
  health: Record<string, { up: boolean | null; message?: string }>,
  watchServices: Record<string, WatchServiceSummary>,
  services: ServiceConfig[],
  resolveUrl: (service: ServiceConfig) => string,
): CompanionPcStatus | null {
  const pc = pickCompanionPc(pcConfigs, pcs);
  if (!pc) return null;

  const wiredIds = Object.entries(watchServices)
    .filter(
      ([, cfg]) =>
        cfg?.monitor !== false && String(cfg?.restartPcId || "") === pc.id,
    )
    .map(([id]) => id);

  const candidateIds =
    wiredIds.length > 0
      ? wiredIds
      : COMPANION_FALLBACK_IDS.filter((id) =>
          services.some((service) => service.id === id && service.enabled),
        );

  const apps: CompanionAppStatus[] = [];
  for (const id of candidateIds) {
    const service = services.find((item) => item.id === id && item.enabled);
    if (!service) continue;
    const entry = health[id];
    apps.push({
      id,
      label: service.name,
      up: entry?.up ?? null,
      message: entry?.message,
      openUrl: openUrlForService(service, resolveUrl),
    });
  }

  return {
    pc,
    online: pcs[pc.id]?.online ?? null,
    message: pcs[pc.id]?.message,
    apps,
  };
}

export function companionChipMeta(
  summary: CompanionPcStatus | null,
  scanning: boolean,
): { value: string; tone: CompanionChipTone } | null {
  if (!summary) return null;

  const appsUp = summary.apps.filter((app) => app.up === true).length;
  const appsDown = summary.apps.filter((app) => app.up === false).length;
  const appsTotal = summary.apps.length;

  if (scanning && summary.online === null && appsUp === 0 && appsDown === 0) {
    return { value: "…", tone: "muted" };
  }

  if (summary.online === false) {
    return { value: "Offline", tone: "bad" };
  }

  if (appsDown > 0) {
    return {
      value: appsTotal > 0 ? `${appsUp}/${appsTotal}` : "Offline",
      tone: "bad",
    };
  }

  if (summary.online === true) {
    if (appsTotal === 0) return { value: "Online", tone: "good" };
    if (appsUp === appsTotal) {
      return {
        value: appsTotal > 1 ? `${appsUp}/${appsTotal}` : "Online",
        tone: "good",
      };
    }
    return { value: `${appsUp}/${appsTotal}`, tone: "warn" };
  }

  return { value: "—", tone: "muted" };
}

export function mergeCompanionDisplayApps(
  apps: CompanionAppStatus[],
  extra: Array<{
    id: string;
    label?: string;
    openUrl?: string | null;
  }>,
): CompanionAppStatus[] {
  const byId = new Map(apps.map((app) => [app.id, { ...app }]));
  for (const ver of extra) {
    if (!byId.has(ver.id)) {
      byId.set(ver.id, {
        id: ver.id,
        label: ver.label || ver.id,
        up: null,
        openUrl: ver.openUrl || null,
        message: undefined,
      });
    }
  }
  const ordered = COMPANION_APP_ORDER.map((id) => byId.get(id)).filter(
    (app): app is CompanionAppStatus => Boolean(app),
  );
  const rest = [...byId.values()].filter(
    (app) =>
      !(COMPANION_APP_ORDER as readonly string[]).includes(app.id),
  );
  return [...ordered, ...rest];
}

export { healthLabel as companionAppHealthLabel };
