/** Remote WAN base used in Arrs Hub Chrome bookmarks. */
export const REMOTE_HOST = "http://67.84.101.14";

export type ProbeKind = "arr-ping" | "http" | "plex";

export type ServiceDefinition = {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  color: string;
  probe: ProbeKind;
  /** Prefill enabled for the usual stack */
  defaultEnabled?: boolean;
};

export type ServiceConfig = {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
  color: string;
  probe: ProbeKind;
};

export const DEFAULT_SERVICES: ServiceDefinition[] = [
  {
    id: "sonarr",
    name: "Sonarr",
    description: "TV show management",
    defaultUrl: `${REMOTE_HOST}:8989`,
    color: "#35c5f4",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "radarr",
    name: "Radarr",
    description: "Movie management",
    defaultUrl: `${REMOTE_HOST}:7878`,
    color: "#ffc230",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "lidarr",
    name: "Lidarr",
    description: "Music management",
    defaultUrl: `${REMOTE_HOST}:8686`,
    color: "#35c5f4",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "readarr",
    name: "Readarr",
    description: "Book management",
    defaultUrl: `${REMOTE_HOST}:8787`,
    color: "#ffc230",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "prowlarr",
    name: "Prowlarr",
    description: "Indexer manager",
    defaultUrl: `${REMOTE_HOST}:9696`,
    color: "#e66000",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "bazarr",
    name: "Bazarr",
    description: "Subtitles",
    defaultUrl: `${REMOTE_HOST}:6767`,
    color: "#e66000",
    probe: "arr-ping",
    defaultEnabled: true,
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    description: "Torrent client",
    defaultUrl: `${REMOTE_HOST}:8079`,
    color: "#2f67d2",
    probe: "http",
    defaultEnabled: true,
  },
  {
    id: "sabnzbd",
    name: "SABnzbd",
    description: "Usenet client",
    defaultUrl: `${REMOTE_HOST}:6789/sabnzbd/`,
    color: "#ffc230",
    probe: "http",
    defaultEnabled: true,
  },
  {
    id: "ombi",
    name: "Ombi",
    description: "Requests",
    defaultUrl: `${REMOTE_HOST}:5000`,
    color: "#e5a00d",
    probe: "http",
    defaultEnabled: true,
  },
  {
    id: "tautulli",
    name: "Tautulli",
    description: "Plex stats",
    defaultUrl: `${REMOTE_HOST}:8181`,
    color: "#e5a00d",
    probe: "http",
    defaultEnabled: true,
  },
  {
    id: "fileflows",
    name: "FileFlows",
    description: "File processing",
    defaultUrl: `${REMOTE_HOST}:19200`,
    color: "#10b981",
    probe: "http",
    defaultEnabled: true,
  },
  {
    id: "plex",
    name: "Plex",
    description: "Media server",
    defaultUrl: `${REMOTE_HOST}:32400/web`,
    color: "#e5a00d",
    probe: "plex",
    defaultEnabled: true,
  },
  {
    id: "calibre",
    name: "Calibre",
    description: "Ebook server",
    defaultUrl: `${REMOTE_HOST}:8080`,
    color: "#45b29d",
    probe: "http",
    defaultEnabled: false,
  },
  {
    id: "overseerr",
    name: "Overseerr",
    description: "Requests",
    defaultUrl: `${REMOTE_HOST}:5055`,
    color: "#6366f1",
    probe: "http",
    defaultEnabled: false,
  },
  {
    id: "whisparr",
    name: "Whisparr",
    description: "Adult library",
    defaultUrl: `${REMOTE_HOST}:6969`,
    color: "#ec4899",
    probe: "arr-ping",
    defaultEnabled: false,
  },
];

export function buildDefaultConfigs(): ServiceConfig[] {
  return DEFAULT_SERVICES.map((def) => ({
    id: def.id,
    name: def.name,
    url: def.defaultUrl,
    apiKey: "",
    enabled: def.defaultEnabled !== false,
    color: def.color,
    probe: def.probe,
  }));
}
