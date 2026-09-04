/** Remote WAN base used in Arrs Hub Chrome bookmarks. */
export const REMOTE_HOST = "http://67.84.101.14";

export type ProbeKind = "arr" | "http" | "plex";
export type AuthKind = "apiKey" | "userPass" | "none";

export type ServiceCategory =
  | "media-management"
  | "indexers"
  | "downloaders"
  | "requests"
  | "monitoring"
  | "automation"
  | "other";

export type ServiceDefinition = {
  id: string;
  name: string;
  defaultUrl: string;
  /** Official / LunaSea-style brand accent */
  color: string;
  probe: ProbeKind;
  auth: AuthKind;
  category: ServiceCategory;
  defaultEnabled?: boolean;
};

export type ServiceConfig = {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  username: string;
  password: string;
  enabled: boolean;
  color: string;
  probe: ProbeKind;
  auth: AuthKind;
  category: ServiceCategory;
};

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  "media-management": "Media Management",
  indexers: "Indexers",
  downloaders: "Download Clients",
  requests: "Requests",
  monitoring: "Monitoring & Stats",
  automation: "Automation",
  other: "Other",
};

export const CATEGORY_ORDER: ServiceCategory[] = [
  "media-management",
  "indexers",
  "downloaders",
  "requests",
  "monitoring",
  "automation",
  "other",
];

/** Brand accents aligned with each app (not shared duplicates). */
export const DEFAULT_SERVICES: ServiceDefinition[] = [
  {
    id: "sonarr",
    name: "Sonarr",
    defaultUrl: `${REMOTE_HOST}:8989`,
    color: "#3a7abf",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: true,
  },
  {
    id: "radarr",
    name: "Radarr",
    defaultUrl: `${REMOTE_HOST}:7878`,
    color: "#f5c518",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: true,
  },
  {
    id: "lidarr",
    name: "Lidarr",
    defaultUrl: `${REMOTE_HOST}:8686`,
    color: "#009252",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: true,
  },
  {
    id: "readarr",
    name: "Readarr",
    defaultUrl: `${REMOTE_HOST}:8787`,
    color: "#8e3532",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: true,
  },
  {
    id: "prowlarr",
    name: "Prowlarr",
    defaultUrl: `${REMOTE_HOST}:9696`,
    color: "#e66000",
    probe: "arr",
    auth: "apiKey",
    category: "indexers",
    defaultEnabled: true,
  },
  {
    id: "flaresolverr",
    name: "FlareSolverr",
    defaultUrl: `${REMOTE_HOST}:8191`,
    color: "#f97316",
    probe: "http",
    auth: "none",
    category: "indexers",
    defaultEnabled: true,
  },
  {
    id: "bazarr",
    name: "Bazarr",
    defaultUrl: `${REMOTE_HOST}:6767`,
    color: "#be4b14",
    probe: "http",
    auth: "apiKey",
    category: "automation",
    defaultEnabled: true,
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    defaultUrl: `${REMOTE_HOST}:8079`,
    color: "#3585d2",
    probe: "http",
    auth: "userPass",
    category: "downloaders",
    defaultEnabled: true,
  },
  {
    id: "sabnzbd",
    name: "SABnzbd",
    defaultUrl: `${REMOTE_HOST}:6789/sabnzbd/`,
    color: "#ffc230",
    probe: "http",
    auth: "apiKey",
    category: "downloaders",
    defaultEnabled: true,
  },
  {
    id: "ombi",
    name: "Ombi",
    defaultUrl: `${REMOTE_HOST}:5000`,
    color: "#df7a00",
    probe: "http",
    auth: "apiKey",
    category: "requests",
    defaultEnabled: true,
  },
  {
    id: "tautulli",
    name: "Tautulli",
    defaultUrl: `${REMOTE_HOST}:8181`,
    color: "#cc7b19",
    probe: "http",
    auth: "apiKey",
    category: "monitoring",
    defaultEnabled: true,
  },
  {
    id: "fileflows",
    name: "FileFlows",
    defaultUrl: `${REMOTE_HOST}:19200`,
    color: "#00c2a8",
    probe: "http",
    auth: "none",
    category: "automation",
    defaultEnabled: true,
  },
  {
    id: "fileflows-node",
    name: "FileFlows Node",
    /** No web UI — Hub / Companion report Windows service status. */
    defaultUrl: "companion://local",
    color: "#059669",
    probe: "http",
    auth: "none",
    category: "monitoring",
    defaultEnabled: true,
  },
  {
    id: "plex",
    name: "Plex",
    defaultUrl: `${REMOTE_HOST}:32400`,
    color: "#e5a00d",
    probe: "plex",
    auth: "apiKey",
    category: "other",
    defaultEnabled: true,
  },
  {
    id: "calibre",
    name: "Calibre",
    defaultUrl: `${REMOTE_HOST}:8080`,
    color: "#45b29d",
    probe: "http",
    auth: "userPass",
    category: "media-management",
    defaultEnabled: false,
  },
  {
    id: "overseerr",
    name: "Overseerr",
    defaultUrl: `${REMOTE_HOST}:5055`,
    color: "#6366f1",
    probe: "http",
    auth: "apiKey",
    category: "requests",
    defaultEnabled: false,
  },
  {
    id: "whisparr",
    name: "Whisparr",
    defaultUrl: `${REMOTE_HOST}:6969`,
    color: "#b43e8f",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: false,
  },
  {
    id: "ytarr",
    name: "Ytarr",
    defaultUrl: `${REMOTE_HOST}:8199`,
    color: "#3fb950",
    probe: "http",
    auth: "apiKey",
    category: "media-management",
    defaultEnabled: true,
  },
  {
    id: "workouts",
    name: "Workouts",
    /** Arrs Hub host (desktop default port 3000; set via Settings → Arrs Hub port). */
    defaultUrl: REMOTE_HOST,
    color: "#2dd4bf",
    probe: "http",
    auth: "none",
    category: "other",
    defaultEnabled: true,
  },
  {
    id: "photo-dump",
    name: "Photo Dump",
    /** Arrs Hub host — uploads go to Hub /api/photo-dump/* (default port 3000). */
    defaultUrl: REMOTE_HOST,
    color: "#38bdf8",
    probe: "http",
    auth: "apiKey",
    category: "other",
    defaultEnabled: true,
  },
];

export type CredentialSeed = Partial<
  Record<
    string,
    { apiKey?: string; username?: string; password?: string; url?: string }
  >
>;

const CATEGORY_BY_ID = Object.fromEntries(
  DEFAULT_SERVICES.map((d) => [d.id, d.category]),
) as Record<string, ServiceCategory>;

export function serviceCategory(id: string): ServiceCategory {
  return CATEGORY_BY_ID[id] || "other";
}

export function isCompanionOnlyUrl(url: string): boolean {
  return String(url || "")
    .trim()
    .toLowerCase()
    .startsWith("companion:");
}

/** FileFlows Node (and any companion:// URL) has no HTTP UI to probe or open. */
export function isCompanionOnlyService(
  service: Pick<ServiceConfig, "id" | "url">,
): boolean {
  return service.id === "fileflows-node" || isCompanionOnlyUrl(service.url);
}

export function buildDefaultConfigs(seed: CredentialSeed = {}): ServiceConfig[] {
  return DEFAULT_SERVICES.map((def) => {
    const extra = seed[def.id] ?? {};
    return {
      id: def.id,
      name: def.name,
      url: extra.url?.trim() || def.defaultUrl,
      apiKey: extra.apiKey?.trim() || "",
      username: extra.username?.trim() || "",
      password: extra.password?.trim() || "",
      enabled: def.defaultEnabled !== false,
      color: def.color,
      probe: def.probe,
      auth: def.auth,
      category: def.category,
    };
  });
}

/** Lidarr / Readarr / Prowlarr use /api/v1; Sonarr / Radarr / Whisparr use /api/v3. */
export function arrApiVersion(service: Pick<ServiceConfig, "id">): "v1" | "v3" {
  switch (service.id) {
    case "lidarr":
    case "readarr":
    case "prowlarr":
      return "v1";
    default:
      return "v3";
  }
}
