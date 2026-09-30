import { normalizeBase } from "./http";
import { httpRequest } from "./arrApi";
import type { ServiceConfig } from "./services";

function asObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArray(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

function ombiHeaders(service: ServiceConfig): Record<string, string> {
  const key = service.apiKey.trim();
  if (!key) {
    throw new Error(
      "Ombi API key is not set. Add it under Settings → Ombi (same key as Ombi → Settings → Configuration → General).",
    );
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ApiKey: key,
  };
  // Ombi attributes API-key requests to this user (otherwise "API").
  const alias = service.username.trim();
  if (alias) headers.ApiAlias = alias;
  return headers;
}

async function ombiRequest(
  service: ServiceConfig,
  path: string,
  options: { method?: string; data?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; data: unknown }> {
  const base = normalizeBase(service.url);
  if (!base) {
    throw new Error(
      "Ombi URL is not set. Add it under Settings → Ombi (e.g. http://192.168.x.x:5000).",
    );
  }
  const res = await httpRequest(`${base}${path}`, {
    method: options.method || "GET",
    headers: ombiHeaders(service),
    data: options.data,
    timeoutMs: options.timeoutMs ?? 20000,
  });
  return { status: res.status, data: res.data };
}

function assertOk(
  status: number,
  data: unknown,
  fallback: string,
): void {
  if (status >= 200 && status < 300) {
    const json = asObject(data);
    if (json.isError === true || json.result === false) {
      const msg =
        (typeof json.errorMessage === "string" && json.errorMessage.trim()) ||
        (typeof json.message === "string" && json.message.trim()) ||
        fallback;
      throw new Error(msg);
    }
    return;
  }
  const json = asObject(data);
  const msg =
    (typeof json.errorMessage === "string" && json.errorMessage.trim()) ||
    (typeof json.message === "string" && json.message.trim()) ||
    (typeof json.error === "string" && json.error.trim()) ||
    `${fallback} (HTTP ${status})`;
  throw new Error(msg);
}

export type OmbiMediaKind = "movie" | "tv" | "music";

/** Movies+TV together (Ombi main search) vs music (Lidarr albums). */
export type OmbiSearchMode = "media" | "music";

export type OmbiSearchHit = {
  key: string;
  kind: OmbiMediaKind;
  title: string;
  year: string;
  overview: string;
  posterUrl: string | null;
  /** TMDb id for movies / often TV on newer Ombi. */
  tmdbId: number | null;
  /** TVDB id when present (TV requests). */
  tvdbId: number | null;
  /** MusicBrainz / foreign artist id. */
  foreignArtistId: string | null;
  /** Lidarr/MusicBrainz album id — required to request music. */
  foreignAlbumId: string | null;
  available: boolean;
  requested: boolean;
  approved: boolean;
};

function posterUrl(raw: unknown): string | null {
  const path = typeof raw === "string" ? raw.trim() : "";
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const cleaned = path.startsWith("/") ? path : `/${path}`;
  return `https://image.tmdb.org/t/p/w154${cleaned}`;
}

function yearFromDate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const m = /^(\d{4})/.exec(s);
  return m ? m[1]! : "";
}

function numId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapMovie(row: Record<string, unknown>): OmbiSearchHit | null {
  const tmdbId = numId(row.id) ?? numId(row.theMovieDbId);
  const title = String(row.title || row.name || "").trim();
  if (!title || !tmdbId) return null;
  return {
    key: `movie-${tmdbId}`,
    kind: "movie",
    title,
    year: yearFromDate(row.releaseDate),
    overview: String(row.overview || "").trim(),
    posterUrl: posterUrl(row.posterPath),
    tmdbId,
    tvdbId: null,
    foreignArtistId: null,
    foreignAlbumId: null,
    available: row.available === true,
    requested: row.requested === true,
    approved: row.approved === true,
  };
}

function mapTv(row: Record<string, unknown>): OmbiSearchHit | null {
  const tvdbId = numId(row.id) ?? numId(row.tvDbId) ?? numId(row.tvdbId);
  const tmdbId = numId(row.theMovieDbId) ?? numId(row.tmdbId);
  const title = String(row.title || row.name || "").trim();
  if (!title || (!tvdbId && !tmdbId)) return null;
  return {
    key: `tv-${tvdbId || tmdbId}`,
    kind: "tv",
    title,
    year: yearFromDate(row.firstAired || row.releaseDate),
    overview: String(row.overview || "").trim(),
    posterUrl: posterUrl(row.posterPath),
    tmdbId,
    tvdbId,
    foreignArtistId: null,
    foreignAlbumId: null,
    available:
      row.available === true ||
      row.fullyAvailable === true ||
      row.partlyAvailable === true,
    requested: row.requested === true,
    approved: row.approved === true,
  };
}

/**
 * Ombi's SearchArtistViewModel misspells the field as `ForignArtistId`
 * (missing 'e'). Accept both spellings so artist results aren't dropped.
 */
export function readForeignArtistId(row: Record<string, unknown>): string {
  return String(
    row.foreignArtistId ||
      row.forignArtistId ||
      row.ForeignArtistId ||
      row.ForignArtistId ||
      row.id ||
      row.artistId ||
      "",
  ).trim();
}

function mapMusicArtist(row: Record<string, unknown>): OmbiSearchHit | null {
  const foreignArtistId = readForeignArtistId(row);
  const title = String(
    row.artistName || row.name || row.title || "",
  ).trim();
  if (!title || !foreignArtistId) return null;
  return {
    key: `music-artist-${foreignArtistId}`,
    kind: "music",
    title,
    year: "",
    overview: String(row.overview || row.disambiguation || "").trim(),
    posterUrl: posterUrl(row.poster || row.posterPath || row.banner || row.cover),
    tmdbId: null,
    tvdbId: null,
    foreignArtistId,
    foreignAlbumId: null,
    available: row.available === true || row.monitored === true,
    requested: row.requested === true,
    approved: row.approved === true,
  };
}

/** Album hits are what Ombi can actually request (foreignAlbumId). */
function mapMusicAlbum(row: Record<string, unknown>): OmbiSearchHit | null {
  const foreignAlbumId = String(row.foreignAlbumId || row.id || "").trim();
  const albumTitle = String(row.title || row.name || "").trim();
  const artistName = String(row.artistName || "").trim();
  if (!albumTitle || !foreignAlbumId) return null;
  const foreignArtistId = readForeignArtistId(row) || null;
  return {
    key: `music-album-${foreignAlbumId}`,
    kind: "music",
    title: artistName ? `${artistName} — ${albumTitle}` : albumTitle,
    year: yearFromDate(row.releaseDate),
    overview: String(row.albumType || row.overview || "").trim(),
    posterUrl: posterUrl(row.cover || row.disk || row.poster || row.posterPath),
    tmdbId: null,
    tvdbId: null,
    foreignArtistId,
    foreignAlbumId,
    available:
      row.available === true ||
      row.fullyAvailable === true ||
      row.monitored === true,
    requested: row.requested === true,
    approved: row.approved === true,
  };
}

async function searchKind(
  service: ServiceConfig,
  kind: OmbiMediaKind,
  query: string,
): Promise<OmbiSearchHit[]> {
  const encoded = encodeURIComponent(query);
  const path =
    kind === "movie"
      ? `/api/v1/Search/movie/${encoded}`
      : kind === "tv"
        ? `/api/v1/Search/tv/${encoded}`
        : `/api/v1/Search/music/album/${encoded}`;
  const { status, data } = await ombiRequest(service, path, {
    timeoutMs: 25000,
  });
  if (status < 200 || status >= 300) {
    assertOk(status, data, "Ombi search failed");
  }
  const rows = asArray(data);
  const hits: OmbiSearchHit[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const hit =
      kind === "movie"
        ? mapMovie(row)
        : kind === "tv"
          ? mapTv(row)
          : mapMusicAlbum(row);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Music: albums first (requestable); fall back to artists if album search is empty. */
async function searchMusic(service: ServiceConfig, query: string): Promise<OmbiSearchHit[]> {
  const albums = await searchKind(service, "music", query);
  if (albums.length > 0) return albums;

  const encoded = encodeURIComponent(query);
  const { status, data } = await ombiRequest(
    service,
    `/api/v1/Search/music/artist/${encoded}`,
    { timeoutMs: 25000 },
  );
  if (status < 200 || status >= 300) {
    assertOk(status, data, "Ombi music search failed");
  }
  const rows = asArray(data);
  const hits: OmbiSearchHit[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const hit = mapMusicArtist(raw as Record<string, unknown>);
    if (hit) hits.push(hit);
  }
  return hits;
}

/**
 * Search Ombi. `media` = movies + TV in one call (parallel), like Ombi's main bar.
 * `music` = Lidarr albums (requestable), with artist fallback.
 */
export async function searchOmbi(
  service: ServiceConfig,
  mode: OmbiSearchMode,
  query: string,
): Promise<OmbiSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) {
    throw new Error("Enter at least 2 characters to search.");
  }

  if (mode === "music") {
    return searchMusic(service, q);
  }

  const settled = await Promise.allSettled([
    searchKind(service, "movie", q),
    searchKind(service, "tv", q),
  ]);

  const hits: OmbiSearchHit[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      hits.push(...result.value);
    } else {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
    }
  }

  if (!hits.length && errors.length) {
    throw new Error(errors[0] || "Ombi search failed");
  }

  // Movies first, then TV; keep provider order within each kind.
  hits.sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === "movie" ? -1 : 1;
  });
  return hits;
}

export type OmbiSeason = {
  seasonNumber: number;
  episodeNumbers: number[];
  available: boolean;
  requested: boolean;
};

export function mapOmbiSeasons(data: unknown): OmbiSeason[] {
  const json = asObject(data);
  const rows = asArray(json.seasonRequests ?? json.seasons);
  const seasons: OmbiSeason[] = [];
  for (const raw of rows) {
    const row = asObject(raw);
    const seasonNumber = Number(row.seasonNumber);
    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) continue;
    const episodes = asArray(row.episodes).map(asObject);
    const episodeNumbers = episodes
      .map((e) => Number(e.episodeNumber))
      .filter((n) => Number.isFinite(n) && n > 0);
    const allAvailable =
      episodes.length > 0 && episodes.every((e) => e.available === true);
    const allRequested =
      episodes.length > 0 &&
      episodes.every((e) => e.requested === true || e.approved === true || e.available === true);
    seasons.push({
      seasonNumber,
      episodeNumbers,
      available: row.seasonAvailable === true || allAvailable,
      requested: allRequested && !allAvailable,
    });
  }
  return seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/** Season list for the request picker (v1 by TVDB id, v2 by TMDb id as fallback). */
export async function fetchOmbiTvSeasons(
  service: ServiceConfig,
  hit: OmbiSearchHit,
): Promise<OmbiSeason[]> {
  if (hit.tvdbId) {
    const { status, data } = await ombiRequest(
      service,
      `/api/v1/Search/tv/info/${hit.tvdbId}`,
      { timeoutMs: 25000 },
    );
    if (status >= 200 && status < 300) {
      const seasons = mapOmbiSeasons(data);
      if (seasons.length) return seasons;
    }
  }
  if (hit.tmdbId) {
    const { status, data } = await ombiRequest(
      service,
      `/api/v2/Search/tv/moviedb/${hit.tmdbId}`,
      { timeoutMs: 25000 },
    );
    if (status >= 200 && status < 300) return mapOmbiSeasons(data);
  }
  return [];
}

export type OmbiTvRequestScope =
  | { type: "all" }
  | { type: "first" }
  | { type: "latest" }
  | { type: "seasons"; seasons: OmbiSeason[] };

export function buildOmbiTvRequestBody(
  hit: Pick<OmbiSearchHit, "tvdbId" | "tmdbId">,
  scope: OmbiTvRequestScope,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    requestAll: scope.type === "all",
    firstSeason: scope.type === "first",
    latestSeason: scope.type === "latest",
  };
  if (hit.tvdbId) body.tvDbId = hit.tvdbId;
  else if (hit.tmdbId) body.theMovieDbId = hit.tmdbId;
  else throw new Error("Missing TVDB/TMDb id for this show.");
  if (scope.type === "seasons") {
    if (!scope.seasons.length) throw new Error("Pick at least one season.");
    body.seasons = scope.seasons.map((s) => ({
      seasonNumber: s.seasonNumber,
      episodes: s.episodeNumbers.map((episodeNumber) => ({ episodeNumber })),
    }));
  }
  return body;
}

function tvScopeLabel(scope: OmbiTvRequestScope): string {
  switch (scope.type) {
    case "all":
      return "all seasons";
    case "first":
      return "first season";
    case "latest":
      return "latest season";
    default:
      return scope.seasons.length === 1
        ? `season ${scope.seasons[0]!.seasonNumber}`
        : `${scope.seasons.length} seasons`;
  }
}

/** Submit a media request to Ombi (may still need admin approval). */
export async function requestOmbiMedia(
  service: ServiceConfig,
  hit: OmbiSearchHit,
  tvScope: OmbiTvRequestScope = { type: "all" },
): Promise<string> {
  if (hit.available) {
    throw new Error("Already available in the library.");
  }
  if (hit.requested || hit.approved) {
    throw new Error("Already requested in Ombi.");
  }

  if (hit.kind === "movie") {
    if (!hit.tmdbId) throw new Error("Missing TMDb id for this movie.");
    const { status, data } = await ombiRequest(service, "/api/v1/Request/movie", {
      method: "POST",
      data: { theMovieDbId: hit.tmdbId },
    });
    assertOk(status, data, "Movie request failed");
    return `Requested “${hit.title}” via Ombi → Radarr.`;
  }

  if (hit.kind === "tv") {
    const body = buildOmbiTvRequestBody(hit, tvScope);
    const { status, data } = await ombiRequest(service, "/api/v1/Request/tv", {
      method: "POST",
      data: body,
    });
    assertOk(status, data, "TV request failed");
    return `Requested “${hit.title}” (${tvScopeLabel(tvScope)}) via Ombi → Sonarr.`;
  }

  if (!hit.foreignAlbumId) {
    throw new Error(
      "Pick an album to request (Ombi music requests are album-based). Search by album title, or open Ombi web to browse an artist’s albums.",
    );
  }
  const { status, data } = await ombiRequest(service, "/api/v1/Request/music", {
    method: "POST",
    data: { foreignAlbumId: hit.foreignAlbumId },
  });
  assertOk(status, data, "Music request failed");
  return `Requested “${hit.title}” via Ombi → Lidarr.`;
}

export function ombiHitStatusLabel(hit: OmbiSearchHit): string {
  if (hit.available) return "Available";
  if (hit.approved) return "Approved";
  if (hit.requested) return "Requested";
  return "Not requested";
}

export function ombiKindLabel(kind: OmbiMediaKind): string {
  if (kind === "movie") return "Movie";
  if (kind === "tv") return "TV";
  return "Music";
}

/**
 * Deny a pending Ombi request directly (chip approve still goes through Hub).
 * Uses the Ombi service URL + API key from Settings.
 */
export async function denyOmbiRequestDirect(
  service: ServiceConfig,
  item: { type: "movie" | "tv" | "music"; id: number },
  reason = "",
): Promise<void> {
  const pathByType = {
    movie: "movie/deny",
    tv: "tv/deny",
    music: "music/deny",
  } as const;
  const path = pathByType[item.type];
  const body: Record<string, unknown> = { id: item.id };
  if (reason.trim()) body.reason = reason.trim();
  // Ombi deny endpoints are PUT (not POST).
  const { status, data } = await ombiRequest(
    service,
    `/api/v1/Request/${path}`,
    { method: "PUT", data: body },
  );
  assertOk(status, data, "Deny failed");
}

export type OmbiRequestStatus = "pending" | "approved" | "available" | "denied";

export type OmbiRequestRow = {
  key: string;
  /** Id Ombi's approve/deny endpoints expect (TV = child request id). */
  id: number;
  kind: OmbiMediaKind;
  title: string;
  subtitle: string;
  posterUrl: string | null;
  requestedBy: string;
  requestedAt: string;
  status: OmbiRequestStatus;
  deniedReason: string;
};

function requestStatus(row: Record<string, unknown>): OmbiRequestStatus {
  if (row.denied === true) return "denied";
  if (row.available === true) return "available";
  if (row.approved === true) return "approved";
  return "pending";
}

function requestedBy(row: Record<string, unknown>): string {
  const user = asObject(row.requestedUser);
  return String(
    user.alias || user.userAlias || user.userName || user.normalizedUserName || row.requestedUserAlias || "",
  ).trim();
}

export function mapOmbiRequests(
  kind: OmbiMediaKind,
  data: unknown,
): OmbiRequestRow[] {
  const rows = asArray(Array.isArray(data) ? data : asObject(data).collection);
  const out: OmbiRequestRow[] = [];
  for (const raw of rows) {
    const row = asObject(raw);
    if (kind === "tv") {
      const title = String(row.title || "").trim();
      const poster = posterUrl(row.posterPath);
      for (const childRaw of asArray(row.childRequests)) {
        const child = asObject(childRaw);
        const id = numId(child.id);
        if (!id) continue;
        const seasons = asArray(child.seasonRequests)
          .map((s) => Number(asObject(s).seasonNumber))
          .filter((n) => Number.isFinite(n) && n > 0);
        out.push({
          key: `tv-${id}`,
          id,
          kind,
          title: title || String(asObject(child.parentRequest).title || "TV show"),
          subtitle: seasons.length
            ? `Season${seasons.length > 1 ? "s" : ""} ${seasons.join(", ")}`
            : "",
          posterUrl: poster,
          requestedBy: requestedBy(child),
          requestedAt: String(child.requestedDate || ""),
          status: requestStatus(child),
          deniedReason: String(child.deniedReason || "").trim(),
        });
      }
      continue;
    }
    const id = numId(row.id);
    if (!id) continue;
    const title = String(row.title || "").trim();
    out.push({
      key: `${kind}-${id}`,
      id,
      kind,
      title: kind === "music" && row.artistName ? `${row.artistName} — ${title}` : title,
      subtitle: yearFromDate(row.releaseDate),
      posterUrl: posterUrl(kind === "music" ? row.cover || row.disk : row.posterPath),
      requestedBy: requestedBy(row),
      requestedAt: String(row.requestedDate || ""),
      status: requestStatus(row),
      deniedReason: String(row.deniedReason || "").trim(),
    });
  }
  return out;
}

/** Recent requests across movies, TV and music (newest first). */
export async function fetchOmbiRequests(
  service: ServiceConfig,
): Promise<OmbiRequestRow[]> {
  const kinds: OmbiMediaKind[] = ["movie", "tv", "music"];
  const settled = await Promise.allSettled(
    kinds.map(async (kind) => {
      const { status, data } = await ombiRequest(service, `/api/v1/Request/${kind}`);
      // Music 4xx just means Lidarr isn't set up in Ombi.
      if (kind === "music" && status >= 400) return [];
      assertOk(status, data, `${ombiKindLabel(kind)} requests failed`);
      return mapOmbiRequests(kind, data);
    }),
  );
  const rows: OmbiRequestRow[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") rows.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  if (!rows.length && errors.length) throw new Error(errors[0]);
  return rows.sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""));
}

export function ombiRequestStatusLabel(status: OmbiRequestStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    default:
      return "Pending approval";
  }
}
