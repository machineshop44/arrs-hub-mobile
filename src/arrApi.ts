import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { ServiceConfig } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; data: unknown; latencyMs: number }> {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers ?? {};
  const timeoutMs = options.timeoutMs ?? 20000;
  const started = performance.now();

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: options.data,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    return {
      status: res.status,
      data: res.data,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const res = await fetch(url, {
    method,
    headers,
    body:
      options.data === undefined
        ? undefined
        : typeof options.data === "string"
          ? options.data
          : JSON.stringify(options.data),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return {
    status: res.status,
    data,
    latencyMs: Math.round(performance.now() - started),
  };
}

export function arrHeaders(service: ServiceConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (service.apiKey.trim()) headers["X-Api-Key"] = service.apiKey.trim();
  return headers;
}

export async function arrGet(service: ServiceConfig, apiPath: string) {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return httpRequest(`${base}${path}`, {
    headers: arrHeaders(service),
  });
}

export async function arrPost(
  service: ServiceConfig,
  apiPath: string,
  data: unknown,
) {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return httpRequest(`${base}${path}`, {
    method: "POST",
    headers: {
      ...arrHeaders(service),
      "Content-Type": "application/json",
    },
    data,
  });
}

export type ArrKind = "series" | "movie" | "artist" | "author" | "unknown";

export function detectArrKind(service: ServiceConfig): ArrKind {
  switch (service.id) {
    case "sonarr":
      return "series";
    case "radarr":
    case "whisparr":
      return "movie";
    case "lidarr":
      return "artist";
    case "readarr":
      return "author";
    default:
      return "unknown";
  }
}

export type ArrQueueItem = {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  sizeleft?: number;
  timeleft?: string;
};

export type ArrWantedItem = {
  id: number;
  title: string;
  status?: string;
};

export type ArrCalendarItem = {
  id: number;
  title: string;
  airDateUtc?: string;
  releaseDate?: string;
  hasFile?: boolean;
};

export type ArrLookupItem = {
  key: string;
  title: string;
  year?: number;
  overview?: string;
  alreadyAdded: boolean;
  addedId?: number;
  raw: Record<string, unknown>;
};

export type ArrReleaseItem = {
  guid: string;
  title: string;
  indexer?: string;
  size?: number;
  seeders?: number;
  quality?: string;
  approved: boolean;
  raw: Record<string, unknown>;
};

export type ArrAddProfile = {
  qualityProfiles: { id: number; name: string }[];
  rootFolders: { path: string; freeSpace?: number }[];
  languageProfiles?: { id: number; name: string }[];
  metadataProfiles?: { id: number; name: string }[];
};

function asRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { records?: unknown }).records)
  ) {
    return (data as { records: Record<string, unknown>[] }).records;
  }
  return [];
}

function asList(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export async function fetchArrOverview(service: ServiceConfig) {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);
  const end = endDate.toISOString().slice(0, 10);

  const [statusRes, queueRes, calendarRes, library] = await Promise.all([
    arrGet(service, "/api/v3/system/status"),
    arrGet(service, "/api/v3/queue?pageSize=20"),
    arrGet(
      service,
      `/api/v3/calendar?start=${start}&end=${end}&unmonitored=false`,
    ),
    fetchLibrary(service).catch(() => [] as ArrLibraryItem[]),
  ]);

  const queue = asRecords(queueRes.data).map((row) => ({
    id: Number(row.id) || 0,
    title: String(row.title || row.sourceTitle || "Queue item"),
    status: String(row.status || row.trackedDownloadState || ""),
    trackedDownloadState: row.trackedDownloadState
      ? String(row.trackedDownloadState)
      : undefined,
    sizeleft: typeof row.sizeleft === "number" ? row.sizeleft : undefined,
    timeleft: row.timeleft ? String(row.timeleft) : undefined,
  })) as ArrQueueItem[];

  const calendar = asRecords(calendarRes.data).map((row) => ({
    id: Number(row.id) || 0,
    title: String(
      row.title ||
        row.seriesTitle ||
        (row.series as { title?: string } | undefined)?.title ||
        "Upcoming",
    ),
    airDateUtc: row.airDateUtc ? String(row.airDateUtc) : undefined,
    releaseDate: row.releaseDate ? String(row.releaseDate) : undefined,
    hasFile: Boolean(row.hasFile),
  })) as ArrCalendarItem[];

  const statusOk = statusRes.status >= 200 && statusRes.status < 300;
  const version =
    statusOk && statusRes.data && typeof statusRes.data === "object"
      ? String((statusRes.data as { version?: string }).version || "")
      : "";

  return {
    ok: statusOk,
    version,
    queue,
    calendar,
    library,
    errors: [
      statusRes.status >= 400 ? `Status ${statusRes.status}` : null,
      queueRes.status >= 400 ? `Queue ${queueRes.status}` : null,
      calendarRes.status >= 400 ? `Calendar ${calendarRes.status}` : null,
    ].filter(Boolean) as string[],
  };
}

export async function triggerArrCommand(
  service: ServiceConfig,
  name: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  const res = await arrPost(service, "/api/v3/command", { name, ...body });
  if (res.status >= 400) {
    throw new Error(`Command failed (${res.status})`);
  }
}

export async function fetchAddProfiles(
  service: ServiceConfig,
): Promise<ArrAddProfile> {
  const kind = detectArrKind(service);
  const [qp, roots, lang, meta] = await Promise.all([
    arrGet(service, "/api/v3/qualityprofile"),
    arrGet(service, "/api/v3/rootfolder"),
    kind === "series"
      ? arrGet(service, "/api/v3/languageprofile").catch(() => ({
          status: 404,
          data: [],
          latencyMs: 0,
        }))
      : Promise.resolve({ status: 404, data: [], latencyMs: 0 }),
    kind === "artist" || kind === "author"
      ? arrGet(service, "/api/v3/metadataprofile").catch(() => ({
          status: 404,
          data: [],
          latencyMs: 0,
        }))
      : Promise.resolve({ status: 404, data: [], latencyMs: 0 }),
  ]);

  return {
    qualityProfiles: asList(qp.data).map((row) => ({
      id: Number(row.id),
      name: String(row.name || row.id),
    })),
    rootFolders: asList(roots.data).map((row) => ({
      path: String(row.path || ""),
      freeSpace:
        typeof row.freeSpace === "number" ? row.freeSpace : undefined,
    })),
    languageProfiles: asList(lang.data).map((row) => ({
      id: Number(row.id),
      name: String(row.name || row.id),
    })),
    metadataProfiles: asList(meta.data).map((row) => ({
      id: Number(row.id),
      name: String(row.name || row.id),
    })),
  };
}

export async function lookupMedia(
  service: ServiceConfig,
  term: string,
): Promise<ArrLookupItem[]> {
  const q = term.trim();
  if (!q) return [];
  const kind = detectArrKind(service);
  const encoded = encodeURIComponent(q);
  let path = "";
  if (kind === "series") path = `/api/v3/series/lookup?term=${encoded}`;
  else if (kind === "movie") path = `/api/v3/movie/lookup?term=${encoded}`;
  else if (kind === "artist") path = `/api/v3/artist/lookup?term=${encoded}`;
  else if (kind === "author") path = `/api/v3/author/lookup?term=${encoded}`;
  else throw new Error("Search is not supported for this app yet.");

  const res = await arrGet(service, path);
  if (res.status >= 400) {
    throw new Error(`Lookup failed (${res.status})`);
  }

  return asList(res.data).map((row, index) => {
    const title = String(row.title || row.artistName || row.authorName || "Result");
    const year = typeof row.year === "number" ? row.year : undefined;
    const id = Number(row.id) || 0;
    const alreadyAdded = id > 0;
    return {
      key: `${title}-${year || ""}-${row.tvdbId || row.tmdbId || row.foreignArtistId || index}`,
      title,
      year,
      overview: row.overview ? String(row.overview) : undefined,
      alreadyAdded,
      addedId: alreadyAdded ? id : undefined,
      raw: row,
    };
  });
}

export async function addAndSearch(
  service: ServiceConfig,
  item: ArrLookupItem,
  profiles: ArrAddProfile,
): Promise<string> {
  const kind = detectArrKind(service);
  const qualityProfileId = profiles.qualityProfiles[0]?.id;
  const rootFolderPath = profiles.rootFolders[0]?.path;
  if (!qualityProfileId || !rootFolderPath) {
    throw new Error("No quality profile or root folder configured in the *arr app.");
  }

  if (kind === "series") {
    const payload = {
      ...item.raw,
      qualityProfileId,
      rootFolderPath,
      monitored: true,
      seasonFolder: true,
      seriesType: item.raw.seriesType || "standard",
      addOptions: {
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: false,
      },
      languageProfileId:
        profiles.languageProfiles?.[0]?.id || item.raw.languageProfileId,
    };
    delete (payload as { id?: number }).id;
    const res = await arrPost(service, "/api/v3/series", payload);
    if (res.status >= 400) {
      throw new Error(`Add series failed (${res.status})`);
    }
    return "Added series and started search for missing episodes.";
  }

  if (kind === "movie") {
    const payload = {
      ...item.raw,
      qualityProfileId,
      rootFolderPath,
      monitored: true,
      minimumAvailability: item.raw.minimumAvailability || "announced",
      addOptions: {
        searchForMovie: true,
      },
    };
    delete (payload as { id?: number }).id;
    const res = await arrPost(service, "/api/v3/movie", payload);
    if (res.status >= 400) {
      throw new Error(`Add movie failed (${res.status})`);
    }
    return "Added movie and sent search to download clients.";
  }

  if (kind === "artist") {
    const payload = {
      ...item.raw,
      qualityProfileId,
      metadataProfileId: profiles.metadataProfiles?.[0]?.id,
      rootFolderPath,
      monitored: true,
      addOptions: {
        searchForMissingAlbums: true,
      },
    };
    delete (payload as { id?: number }).id;
    const res = await arrPost(service, "/api/v3/artist", payload);
    if (res.status >= 400) {
      throw new Error(`Add artist failed (${res.status})`);
    }
    return "Added artist and started missing album search.";
  }

  if (kind === "author") {
    const payload = {
      ...item.raw,
      qualityProfileId,
      metadataProfileId: profiles.metadataProfiles?.[0]?.id,
      rootFolderPath,
      monitored: true,
      addOptions: {
        searchForMissingBooks: true,
      },
    };
    delete (payload as { id?: number }).id;
    const res = await arrPost(service, "/api/v3/author", payload);
    if (res.status >= 400) {
      throw new Error(`Add author failed (${res.status})`);
    }
    return "Added author and started missing book search.";
  }

  throw new Error("Unsupported *arr type.");
}

/** Search indexers for an already-added title and queue best effort via MoviesSearch/SeriesSearch. */
export async function searchExisting(
  service: ServiceConfig,
  item: ArrLookupItem,
): Promise<string> {
  const kind = detectArrKind(service);
  const id = item.addedId;
  if (!id) throw new Error("Item is not in the library yet.");

  if (kind === "series") {
    await triggerArrCommand(service, "SeriesSearch", { seriesId: id });
    return "Series search sent to indexers / download clients.";
  }
  if (kind === "movie") {
    await triggerArrCommand(service, "MoviesSearch", { movieIds: [id] });
    return "Movie search sent to indexers / download clients.";
  }
  if (kind === "artist") {
    await triggerArrCommand(service, "ArtistSearch", { artistId: id });
    return "Artist search sent to indexers / download clients.";
  }
  if (kind === "author") {
    await triggerArrCommand(service, "AuthorSearch", { authorId: id });
    return "Author search sent to indexers / download clients.";
  }
  throw new Error("Unsupported *arr type.");
}

export type ArrLibraryItem = {
  id: number;
  title: string;
  year?: number;
  status?: string;
  monitored: boolean;
  hasFile?: boolean;
  network?: string;
  episodeCount?: number;
  episodeFileCount?: number;
};

export type ArrEpisodeItem = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  hasFile: boolean;
  monitored: boolean;
  overview?: string;
};

export async function fetchLibrary(
  service: ServiceConfig,
): Promise<ArrLibraryItem[]> {
  const kind = detectArrKind(service);
  let path = "";
  if (kind === "series") path = "/api/v3/series";
  else if (kind === "movie") path = "/api/v3/movie";
  else if (kind === "artist") path = "/api/v3/artist";
  else if (kind === "author") path = "/api/v3/author";
  else return [];

  const res = await arrGet(service, path);
  if (res.status >= 400) {
    throw new Error(`Library failed (${res.status})`);
  }

  return asList(res.data)
    .map((row) => {
      const title = String(
        row.title || row.artistName || row.authorName || "Item",
      );
      const stats = row.statistics as
        | {
            episodeCount?: number;
            episodeFileCount?: number;
            movieFileCount?: number;
          }
        | undefined;
      return {
        id: Number(row.id) || 0,
        title,
        year: typeof row.year === "number" ? row.year : undefined,
        status: row.status ? String(row.status) : undefined,
        monitored: row.monitored !== false,
        hasFile: Boolean(row.hasFile) || (stats?.movieFileCount ?? 0) > 0,
        network: row.network ? String(row.network) : undefined,
        episodeCount: stats?.episodeCount,
        episodeFileCount: stats?.episodeFileCount,
      } as ArrLibraryItem;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchSeriesEpisodes(
  service: ServiceConfig,
  seriesId: number,
): Promise<ArrEpisodeItem[]> {
  const res = await arrGet(
    service,
    `/api/v3/episode?seriesId=${seriesId}&includeImages=false`,
  );
  if (res.status >= 400) {
    throw new Error(`Episodes failed (${res.status})`);
  }
  return asList(res.data)
    .map((row) => ({
      id: Number(row.id) || 0,
      seasonNumber: Number(row.seasonNumber) || 0,
      episodeNumber: Number(row.episodeNumber) || 0,
      title: String(row.title || `Episode ${row.episodeNumber}`),
      airDate: row.airDate ? String(row.airDate) : undefined,
      hasFile: Boolean(row.hasFile),
      monitored: row.monitored !== false,
      overview: row.overview ? String(row.overview) : undefined,
    }))
    .sort((a, b) =>
      a.seasonNumber === b.seasonNumber
        ? a.episodeNumber - b.episodeNumber
        : a.seasonNumber - b.seasonNumber,
    );
}

export async function searchEpisode(
  service: ServiceConfig,
  episodeIds: number[],
): Promise<string> {
  await triggerArrCommand(service, "EpisodeSearch", { episodeIds });
  return "Episode search sent to download clients.";
}

export async function fetchEpisodeReleases(
  service: ServiceConfig,
  episodeId: number,
): Promise<ArrReleaseItem[]> {
  const res = await arrGet(service, `/api/v3/release?episodeId=${episodeId}`);
  if (res.status >= 400) {
    throw new Error(`Release search failed (${res.status})`);
  }
  return asList(res.data)
    .slice(0, 40)
    .map((row, index) => {
      const quality = row.quality as
        | { quality?: { name?: string } }
        | undefined;
      return {
        guid: String(row.guid || `${index}`),
        title: String(row.title || "Release"),
        indexer: row.indexer ? String(row.indexer) : undefined,
        size: typeof row.size === "number" ? row.size : undefined,
        seeders: typeof row.seeders === "number" ? row.seeders : undefined,
        quality: quality?.quality?.name,
        approved: row.approved !== false,
        raw: row,
      };
    });
}

/** Lookup payload often includes seasons — useful before the show is added. */
export function seasonsFromLookup(
  item: ArrLookupItem,
): { seasonNumber: number; episodeCount?: number; monitored?: boolean }[] {
  const seasons = item.raw.seasons;
  if (!Array.isArray(seasons)) return [];
  return seasons
    .map((s) => {
      const row = s as {
        seasonNumber?: number;
        monitored?: boolean;
        statistics?: { episodeCount?: number };
      };
      return {
        seasonNumber: Number(row.seasonNumber) || 0,
        episodeCount: row.statistics?.episodeCount,
        monitored: row.monitored,
      };
    })
    .filter((s) => s.seasonNumber >= 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

export async function fetchReleasesForLookup(
  service: ServiceConfig,
  item: ArrLookupItem,
): Promise<ArrReleaseItem[]> {
  const kind = detectArrKind(service);
  let path = "";
  if (kind === "movie") {
    const movieId = item.addedId || 0;
    if (!movieId) {
      throw new Error("Add the movie first, then use Grab releases.");
    }
    path = `/api/v3/release?movieId=${movieId}`;
  } else if (kind === "series") {
    const seriesId = item.addedId || 0;
    if (!seriesId) {
      throw new Error("Add the series first, then browse episodes to grab.");
    }
    path = `/api/v3/release?seriesId=${seriesId}`;
  } else {
    throw new Error("Interactive grab is available for Sonarr/Radarr first.");
  }

  const res = await arrGet(service, path);
  if (res.status >= 400) {
    throw new Error(`Release search failed (${res.status})`);
  }

  return asList(res.data)
    .slice(0, 40)
    .map((row, index) => {
      const quality = row.quality as
        | { quality?: { name?: string } }
        | undefined;
      return {
        guid: String(row.guid || `${index}`),
        title: String(row.title || "Release"),
        indexer: row.indexer ? String(row.indexer) : undefined,
        size: typeof row.size === "number" ? row.size : undefined,
        seeders: typeof row.seeders === "number" ? row.seeders : undefined,
        quality: quality?.quality?.name,
        approved: row.approved !== false,
        raw: row,
      };
    });
}

export async function grabRelease(
  service: ServiceConfig,
  release: ArrReleaseItem,
): Promise<string> {
  const res = await arrPost(service, "/api/v3/release", release.raw);
  if (res.status >= 400) {
    throw new Error(`Grab failed (${res.status})`);
  }
  return "Sent to download client.";
}

export function formatBytes(size?: number): string {
  if (!size || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
