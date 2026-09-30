import {
  fetchArrCalendar,
  fetchArrDiskSpace,
  fetchArrHealth,
  type ArrCalendarItem,
  type ArrDiskSpace,
  type ArrHealthItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";

export const UPCOMING_APP_IDS = ["sonarr", "radarr", "lidarr"] as const;
export const HEALTH_APP_IDS = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "prowlarr"] as const;
/** Disk space comes from the media managers (Prowlarr has no library). */
const DISK_APP_IDS = new Set(["sonarr", "radarr", "lidarr", "readarr", "whisparr"]);

export type UpcomingItem = ArrCalendarItem & { appId: string; appName: string };

export type HealthIssue = ArrHealthItem & { appId: string; appName: string };

export type DiskEntry = ArrDiskSpace & { appNames: string[] };

export type ArrHealthSummary = {
  issues: HealthIssue[];
  disks: DiskEntry[];
  lowDisk: DiskEntry[];
  checked: number;
  failed: string[];
};

/** Low when under 10% or under 50 GB free. */
export function isLowDisk(d: Pick<ArrDiskSpace, "freeSpace" | "totalSpace">): boolean {
  if (d.totalSpace <= 0) return false;
  return d.freeSpace / d.totalSpace < 0.1 || d.freeSpace < 50 * 1024 ** 3;
}

function usable(
  services: ServiceConfig[],
  ids: readonly string[],
  resolveUrl: (s: ServiceConfig) => string,
): ServiceConfig[] {
  return services
    .filter((s) => ids.includes(s.id) && s.enabled && s.apiKey.trim())
    .map((s) => ({ ...s, url: resolveUrl(s) }))
    .filter((s) => s.url.trim());
}

export async function fetchUpcoming(
  services: ServiceConfig[],
  resolveUrl: (s: ServiceConfig) => string,
  days = 7,
): Promise<UpcomingItem[]> {
  const apps = usable(services, UPCOMING_APP_IDS, resolveUrl);
  const settled = await Promise.allSettled(
    apps.map(async (s) =>
      (await fetchArrCalendar(s, days))
        .filter((item) => !item.hasFile)
        .map((item) => ({ ...item, appId: s.id, appName: s.name })),
    ),
  );
  return settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) =>
      String(a.airDateUtc || a.releaseDate || "").localeCompare(
        String(b.airDateUtc || b.releaseDate || ""),
      ),
    );
}

/** Merge disks reported by several arrs (same mount shows up in each). */
export function mergeDisks(
  perApp: { appName: string; disks: ArrDiskSpace[] }[],
): DiskEntry[] {
  const byPath = new Map<string, DiskEntry>();
  for (const { appName, disks } of perApp) {
    for (const d of disks) {
      const key = d.path.replace(/[\\/]+$/, "").toLowerCase();
      const existing = byPath.get(key);
      if (existing) {
        if (!existing.appNames.includes(appName)) existing.appNames.push(appName);
      } else {
        byPath.set(key, { ...d, appNames: [appName] });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.freeSpace / a.totalSpace - b.freeSpace / b.totalSpace);
}

export async function fetchArrHealthSummary(
  services: ServiceConfig[],
  resolveUrl: (s: ServiceConfig) => string,
): Promise<ArrHealthSummary> {
  const apps = usable(services, HEALTH_APP_IDS, resolveUrl);
  const failed: string[] = [];
  const results = await Promise.all(
    apps.map(async (s) => {
      const [health, disks] = await Promise.all([
        fetchArrHealth(s).catch(() => null),
        DISK_APP_IDS.has(s.id) ? fetchArrDiskSpace(s).catch(() => []) : Promise.resolve([]),
      ]);
      if (health == null) failed.push(s.name);
      return { service: s, health: health ?? [], disks };
    }),
  );
  const issues: HealthIssue[] = results.flatMap(({ service, health }) =>
    health
      .filter((h) => h.type === "warning" || h.type === "error")
      .map((h) => ({ ...h, appId: service.id, appName: service.name })),
  );
  issues.sort((a, b) => (a.type === b.type ? 0 : a.type === "error" ? -1 : 1));
  const disks = mergeDisks(results.map((r) => ({ appName: r.service.name, disks: r.disks })));
  return {
    issues,
    disks,
    lowDisk: disks.filter(isLowDisk),
    checked: apps.length,
    failed,
  };
}
