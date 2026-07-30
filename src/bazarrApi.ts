import { httpRequest } from "./arrApi";
import type { ServiceConfig } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function bazarrHeaders(service: ServiceConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (service.apiKey.trim()) headers["X-API-KEY"] = service.apiKey.trim();
  return headers;
}

async function bazarrGet(service: ServiceConfig, apiPath: string, query?: Record<string, string | number>) {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  return httpRequest(`${base}${path}${suffix}`, {
    headers: bazarrHeaders(service),
    timeoutMs: 30000,
  });
}

async function bazarrPostQuery(
  service: ServiceConfig,
  apiPath: string,
  query: Record<string, string | number | boolean>,
) {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    qs.set(k, String(v));
  }
  return httpRequest(`${base}${path}?${qs}`, {
    method: "POST",
    headers: bazarrHeaders(service),
    timeoutMs: 60000,
  });
}

export type BazarrLang = {
  name: string;
  code2?: string;
  code3?: string;
  forced?: boolean;
  hi?: boolean;
};

export type BazarrWantedEpisode = {
  kind: "episode";
  key: string;
  seriesTitle: string;
  episodeNumber: string;
  episodeTitle: string;
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  missing: BazarrLang[];
  sceneName?: string;
};

export type BazarrWantedMovie = {
  kind: "movie";
  key: string;
  title: string;
  radarrId: number;
  missing: BazarrLang[];
  sceneName?: string;
};

export type BazarrWantedItem = BazarrWantedEpisode | BazarrWantedMovie;

export type BazarrHistoryItem = {
  kind: "episode" | "movie";
  key: string;
  title: string;
  subtitle?: string;
  language?: string;
  provider?: string;
  timestamp?: string;
  action?: number;
  description?: string;
};

export type BazarrProviderResult = {
  provider: string;
  subtitle: string;
  language: string;
  score: number;
  hearing_impaired: string;
  forced: string;
  original_format: string;
  uploader?: string;
};

function asRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  }
  return [];
}

function parseMissing(raw: unknown): BazarrLang[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      return {
        name: String(o.name || o.code2 || "unknown"),
        code2: o.code2 ? String(o.code2) : undefined,
        code3: o.code3 ? String(o.code3) : undefined,
        forced: Boolean(o.forced),
        hi: Boolean(o.hi),
      };
    }
    return { name: String(item) };
  });
}

function langLabel(langs: BazarrLang[]): string {
  if (!langs.length) return "missing";
  return langs
    .map((l) => {
      const flags = [l.forced ? "forced" : "", l.hi ? "HI" : ""].filter(Boolean);
      return flags.length ? `${l.name} (${flags.join(", ")})` : l.name;
    })
    .join(", ");
}

export function formatMissingLabel(item: BazarrWantedItem): string {
  return langLabel(item.missing);
}

function historyTitle(row: Record<string, unknown>, kind: "episode" | "movie"): {
  title: string;
  subtitle?: string;
} {
  if (kind === "episode") {
    const series = String(row.seriesTitle || "Series");
    const ep = String(row.episode_number || "");
    const epTitle = String(row.episodeTitle || "");
    return {
      title: series,
      subtitle: [ep, epTitle].filter(Boolean).join(" · "),
    };
  }
  return { title: String(row.title || "Movie") };
}

function historyLanguage(row: Record<string, unknown>): string | undefined {
  const lang = row.language;
  if (!lang) return undefined;
  if (typeof lang === "object" && lang) {
    return String((lang as Record<string, unknown>).name || "");
  }
  return String(lang);
}

export async function fetchBazarrWanted(
  service: ServiceConfig,
): Promise<{ ok: boolean; message?: string; items: BazarrWantedItem[]; total: number }> {
  if (!service.apiKey.trim()) {
    return {
      ok: false,
      message: "Add your Bazarr API key in Settings.",
      items: [],
      total: 0,
    };
  }

  try {
    const [eps, movies] = await Promise.all([
      bazarrGet(service, "/api/episodes/wanted", { start: 0, length: 100 }),
      bazarrGet(service, "/api/movies/wanted", { start: 0, length: 100 }),
    ]);

    if (eps.status === 401 || movies.status === 401) {
      return {
        ok: false,
        message: "Bazarr rejected the API key (401).",
        items: [],
        total: 0,
      };
    }

    const items: BazarrWantedItem[] = [];
    for (const row of asRecords(eps.data)) {
      const sonarrEpisodeId = Number(row.sonarrEpisodeId);
      const sonarrSeriesId = Number(row.sonarrSeriesId);
      if (!Number.isFinite(sonarrEpisodeId)) continue;
      items.push({
        kind: "episode",
        key: `ep-${sonarrEpisodeId}`,
        seriesTitle: String(row.seriesTitle || "Series"),
        episodeNumber: String(row.episode_number || ""),
        episodeTitle: String(row.episodeTitle || ""),
        sonarrSeriesId,
        sonarrEpisodeId,
        missing: parseMissing(row.missing_subtitles),
        sceneName: row.sceneName ? String(row.sceneName) : undefined,
      });
    }
    for (const row of asRecords(movies.data)) {
      const radarrId = Number(row.radarrId);
      if (!Number.isFinite(radarrId)) continue;
      items.push({
        kind: "movie",
        key: `movie-${radarrId}`,
        title: String(row.title || "Movie"),
        radarrId,
        missing: parseMissing(row.missing_subtitles),
        sceneName: row.sceneName ? String(row.sceneName) : undefined,
      });
    }

    const epTotal =
      eps.data && typeof eps.data === "object"
        ? Number((eps.data as Record<string, unknown>).total ?? 0)
        : 0;
    const movieTotal =
      movies.data && typeof movies.data === "object"
        ? Number((movies.data as Record<string, unknown>).total ?? 0)
        : 0;

    const httpOk =
      (eps.status >= 200 && eps.status < 400) ||
      (movies.status >= 200 && movies.status < 400);

    return {
      ok: httpOk,
      message: httpOk
        ? undefined
        : `Wanted failed (episodes HTTP ${eps.status}, movies HTTP ${movies.status})`,
      items,
      total: (Number.isFinite(epTotal) ? epTotal : 0) + (Number.isFinite(movieTotal) ? movieTotal : 0) ||
        items.length,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      items: [],
      total: 0,
    };
  }
}

export async function fetchBazarrHistory(
  service: ServiceConfig,
): Promise<{ ok: boolean; message?: string; items: BazarrHistoryItem[] }> {
  if (!service.apiKey.trim()) {
    return {
      ok: false,
      message: "Add your Bazarr API key in Settings.",
      items: [],
    };
  }

  try {
    const [eps, movies] = await Promise.all([
      bazarrGet(service, "/api/episodes/history", { start: 0, length: 40 }),
      bazarrGet(service, "/api/movies/history", { start: 0, length: 40 }),
    ]);

    if (eps.status === 401 || movies.status === 401) {
      return { ok: false, message: "Bazarr rejected the API key (401).", items: [] };
    }

    const items: BazarrHistoryItem[] = [];
    for (const row of asRecords(eps.data)) {
      const { title, subtitle } = historyTitle(row, "episode");
      items.push({
        kind: "episode",
        key: `eh-${row.id ?? items.length}`,
        title,
        subtitle,
        language: historyLanguage(row),
        provider: row.provider ? String(row.provider) : undefined,
        timestamp: row.timestamp ? String(row.timestamp) : undefined,
        action: typeof row.action === "number" ? row.action : undefined,
        description: row.description ? String(row.description) : undefined,
      });
    }
    for (const row of asRecords(movies.data)) {
      const { title, subtitle } = historyTitle(row, "movie");
      items.push({
        kind: "movie",
        key: `mh-${row.id ?? items.length}`,
        title,
        subtitle,
        language: historyLanguage(row),
        provider: row.provider ? String(row.provider) : undefined,
        timestamp: row.timestamp ? String(row.timestamp) : undefined,
        action: typeof row.action === "number" ? row.action : undefined,
        description: row.description ? String(row.description) : undefined,
      });
    }

    // Prefer API order (already timestamp desc per list); interleave by keeping episode then movie batches is fine for MVP.
    return {
      ok:
        (eps.status >= 200 && eps.status < 400) ||
        (movies.status >= 200 && movies.status < 400),
      items,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      items: [],
    };
  }
}

function pickBestProvider(results: BazarrProviderResult[]): BazarrProviderResult | null {
  if (!results.length) return null;
  return [...results].sort((a, b) => (b.score || 0) - (a.score || 0))[0] ?? null;
}

function parseProviderResults(data: unknown): BazarrProviderResult[] {
  return asRecords(data)
    .map((row) => ({
      provider: String(row.provider || ""),
      subtitle: String(row.subtitle || ""),
      language: String(row.language || ""),
      score: Number(row.score ?? 0) || 0,
      hearing_impaired: String(row.hearing_impaired ?? "False"),
      forced: String(row.forced ?? "False"),
      original_format: String(row.original_format ?? "True"),
      uploader: row.uploader ? String(row.uploader) : undefined,
    }))
    .filter((r) => r.provider && r.subtitle);
}

/**
 * Manual search + download best match for one wanted item (LunaSea-style quick action).
 */
export async function searchAndDownloadWanted(
  service: ServiceConfig,
  item: BazarrWantedItem,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (item.kind === "episode") {
      const search = await bazarrGet(service, "/api/providers/episodes", {
        episodeid: item.sonarrEpisodeId,
      });
      if (search.status >= 400) {
        const msg =
          typeof search.data === "string"
            ? search.data
            : `Search failed (HTTP ${search.status})`;
        return { ok: false, message: msg };
      }
      const best = pickBestProvider(parseProviderResults(search.data));
      if (!best) {
        return { ok: false, message: "No subtitle results from providers." };
      }
      const dl = await bazarrPostQuery(service, "/api/providers/episodes", {
        seriesid: item.sonarrSeriesId,
        episodeid: item.sonarrEpisodeId,
        hi: best.hearing_impaired,
        forced: best.forced,
        original_format: best.original_format,
        provider: best.provider,
        subtitle: best.subtitle,
      });
      if (dl.status >= 200 && dl.status < 300) {
        return {
          ok: true,
          message: `Downloading ${best.language || "subtitle"} via ${best.provider} (score ${best.score})`,
        };
      }
      return {
        ok: false,
        message:
          typeof dl.data === "string"
            ? dl.data
            : `Download failed (HTTP ${dl.status})`,
      };
    }

    const search = await bazarrGet(service, "/api/providers/movies", {
      radarrid: item.radarrId,
    });
    if (search.status >= 400) {
      const msg =
        typeof search.data === "string"
          ? search.data
          : `Search failed (HTTP ${search.status})`;
      return { ok: false, message: msg };
    }
    const best = pickBestProvider(parseProviderResults(search.data));
    if (!best) {
      return { ok: false, message: "No subtitle results from providers." };
    }
    const dl = await bazarrPostQuery(service, "/api/providers/movies", {
      radarrid: item.radarrId,
      hi: best.hearing_impaired,
      forced: best.forced,
      original_format: best.original_format,
      provider: best.provider,
      subtitle: best.subtitle,
    });
    if (dl.status >= 200 && dl.status < 300) {
      return {
        ok: true,
        message: `Downloading ${best.language || "subtitle"} via ${best.provider} (score ${best.score})`,
      };
    }
    return {
      ok: false,
      message:
        typeof dl.data === "string"
          ? dl.data
          : `Download failed (HTTP ${dl.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Queue Bazarr's built-in "search missing" scheduler tasks. */
export async function triggerWantedSearchTasks(
  service: ServiceConfig,
): Promise<{ ok: boolean; message: string }> {
  const taskIds = [
    "wanted_search_missing_subtitles_series",
    "wanted_search_missing_subtitles_movies",
  ];
  const results: string[] = [];
  let anyOk = false;
  for (const taskid of taskIds) {
    try {
      const res = await bazarrPostQuery(service, "/api/system/tasks", { taskid });
      if (res.status >= 200 && res.status < 300) {
        anyOk = true;
        results.push(`${taskid}: started`);
      } else {
        results.push(`${taskid}: HTTP ${res.status}`);
      }
    } catch (err) {
      results.push(
        `${taskid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return {
    ok: anyOk,
    message: anyOk
      ? "Queued Bazarr missing-subtitle searches (series + movies)."
      : `Could not start tasks: ${results.join("; ")}`,
  };
}
