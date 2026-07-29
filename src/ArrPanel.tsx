import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addAndSearch,
  detectArrKind,
  fetchAddProfiles,
  fetchArrOverview,
  fetchEpisodeReleases,
  fetchReleasesForLookup,
  fetchSeriesEpisodes,
  formatBytes,
  grabRelease,
  lookupMedia,
  searchEpisode,
  searchExisting,
  seasonsFromLookup,
  type ArrAddProfile,
  type ArrCalendarItem,
  type ArrEpisodeItem,
  type ArrLibraryItem,
  type ArrLookupItem,
  type ArrQueueItem,
  type ArrReleaseItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";

type Tab = "search" | "library" | "queue" | "calendar";
type DetailMode = null | {
  title: string;
  seriesId?: number;
  lookup?: ArrLookupItem;
  movieId?: number;
};

interface ArrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

export function ArrPanel({ service, onBack }: ArrPanelProps) {
  const kind = detectArrKind(service);
  const searchSupported = kind !== "unknown";

  const [tab, setTab] = useState<Tab>(searchSupported ? "search" : "library");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [calendar, setCalendar] = useState<ArrCalendarItem[]>([]);
  const [library, setLibrary] = useState<ArrLibraryItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ArrLookupItem[]>([]);
  const [profiles, setProfiles] = useState<ArrAddProfile | null>(null);
  const [releasesFor, setReleasesFor] = useState<string | null>(null);
  const [releases, setReleases] = useState<ArrReleaseItem[]>([]);

  const [detail, setDetail] = useState<DetailMode>(null);
  const [episodes, setEpisodes] = useState<ArrEpisodeItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<number | "all">("all");

  const load = useCallback(async () => {
    if (!service.apiKey.trim()) {
      setError("Add an API key in Settings for this app.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [data, addProfiles] = await Promise.all([
        fetchArrOverview(service),
        searchSupported
          ? fetchAddProfiles(service).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!data.ok) {
        setError(
          data.errors[0] ||
            "Could not reach the API. Check URL / API key in Settings.",
        );
      } else if (data.errors.length) {
        setError(data.errors.join(" · "));
      }
      setVersion(data.version);
      setQueue(data.queue);
      setCalendar(data.calendar);
      setLibrary(data.library);
      if (addProfiles) setProfiles(addProfiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service, searchSupported]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSeriesDetail = async (
    title: string,
    seriesId: number,
    lookup?: ArrLookupItem,
  ) => {
    setDetail({ title, seriesId, lookup });
    setSeasonFilter("all");
    setReleases([]);
    setReleasesFor(null);
    setDetailLoading(true);
    setError(null);
    try {
      const list = await fetchSeriesEpisodes(service, seriesId);
      setEpisodes(list);
    } catch (err) {
      setEpisodes([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const openLookupPreview = (item: ArrLookupItem) => {
    if (item.alreadyAdded && item.addedId && kind === "series") {
      void openSeriesDetail(item.title, item.addedId, item);
      return;
    }
    if (item.alreadyAdded && item.addedId && kind === "movie") {
      setDetail({ title: item.title, movieId: item.addedId, lookup: item });
      setEpisodes([]);
      return;
    }
    // Not in library yet — show season overview from lookup when available
    setDetail({ title: item.title, lookup: item });
    setEpisodes([]);
    setSeasonFilter("all");
  };

  const filteredLibrary = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return library;
    return library.filter((item) => item.title.toLowerCase().includes(q));
  }, [library, libraryFilter]);

  const seasons = useMemo(() => {
    const set = new Set(episodes.map((e) => e.seasonNumber));
    return [...set].sort((a, b) => a - b);
  }, [episodes]);

  const visibleEpisodes = useMemo(() => {
    if (seasonFilter === "all") return episodes;
    return episodes.filter((e) => e.seasonNumber === seasonFilter);
  }, [episodes, seasonFilter]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    setReleases([]);
    setReleasesFor(null);
    setDetail(null);
    try {
      const found = await lookupMedia(service, query);
      setResults(found);
      if (!found.length) setMessage("No results.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onAddSearch = async (item: ArrLookupItem) => {
    if (!profiles) {
      setError("Could not load quality profiles / root folders.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const msg = await addAndSearch(service, item, profiles);
      setMessage(msg);
      const refreshed = await lookupMedia(service, query || item.title);
      setResults(refreshed);
      await load();
      const added = refreshed.find(
        (r) =>
          r.alreadyAdded &&
          (r.title === item.title ||
            r.raw.tvdbId === item.raw.tvdbId ||
            r.raw.tmdbId === item.raw.tmdbId),
      );
      if (added?.addedId && kind === "series") {
        await openSeriesDetail(added.title, added.addedId, added);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSearchExisting = async (item: ArrLookupItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await searchExisting(service, item));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGrabMovieReleases = async (item: ArrLookupItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const list = await fetchReleasesForLookup(service, item);
      setReleasesFor(item.title);
      setReleases(list);
      if (!list.length) setMessage("No releases found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onEpisodeSearch = async (episode: ArrEpisodeItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await searchEpisode(service, [episode.id]));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onEpisodeGrab = async (episode: ArrEpisodeItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const list = await fetchEpisodeReleases(service, episode.id);
      setReleasesFor(
        `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} · ${episode.title}`,
      );
      setReleases(list);
      if (!list.length) setMessage("No releases for that episode.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGrab = async (release: ArrReleaseItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await grabRelease(service, release));
      await load();
      setTab("queue");
      setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (detail) {
    const previewSeasons = detail.lookup
      ? seasonsFromLookup(detail.lookup)
      : [];
    return (
      <div className="page arr-page">
        <header className="top compact">
          <div className="top-row">
            <button
              type="button"
              className="btn ghost tight"
              onClick={() => {
                setDetail(null);
                setEpisodes([]);
                setReleases([]);
                setReleasesFor(null);
              }}
            >
              ← Back
            </button>
            <div className="arr-title">
              <h1 style={{ color: service.color }}>{detail.title}</h1>
              <p className="sub">
                {detail.seriesId
                  ? "Episode list"
                  : detail.movieId
                    ? "Movie"
                    : "Preview"}
              </p>
            </div>
            <span />
          </div>
        </header>

        {error && <p className="err banner">{error}</p>}
        {message && <p className="ok banner">{message}</p>}

        {detail.lookup && !detail.seriesId && !detail.movieId && (
          <div className="arr-item-actions" style={{ marginTop: "0.65rem" }}>
            <button
              type="button"
              className="btn chip"
              disabled={busy}
              onClick={() => void onAddSearch(detail.lookup!)}
            >
              Add + Search
            </button>
          </div>
        )}

        {detail.movieId && detail.lookup && (
          <div className="arr-item-actions" style={{ marginTop: "0.65rem" }}>
            <button
              type="button"
              className="btn chip"
              disabled={busy}
              onClick={() => void onSearchExisting(detail.lookup!)}
            >
              Search DL
            </button>
            <button
              type="button"
              className="btn chip"
              disabled={busy}
              onClick={() => void onGrabMovieReleases(detail.lookup!)}
            >
              Grab releases…
            </button>
          </div>
        )}

        {!detail.seriesId && previewSeasons.length > 0 && (
          <>
            <p className="hint">Seasons (add the show to browse episodes)</p>
            <ul className="arr-list">
              {previewSeasons.map((s) => (
                <li key={s.seasonNumber} className="arr-item">
                  <strong>
                    {s.seasonNumber === 0 ? "Specials" : `Season ${s.seasonNumber}`}
                  </strong>
                  <span>
                    {s.episodeCount != null
                      ? `${s.episodeCount} episodes`
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {detail.seriesId && (
          <>
            {detailLoading && <p className="hint">Loading episodes…</p>}
            {!detailLoading && seasons.length > 0 && (
              <div className="season-chips">
                <button
                  type="button"
                  className={`btn chip ${seasonFilter === "all" ? "active-chip" : ""}`}
                  onClick={() => setSeasonFilter("all")}
                >
                  All
                </button>
                {seasons.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn chip ${seasonFilter === s ? "active-chip" : ""}`}
                    onClick={() => setSeasonFilter(s)}
                  >
                    {s === 0 ? "Specials" : `S${s}`}
                  </button>
                ))}
              </div>
            )}
            <ul className="arr-list">
              {visibleEpisodes.map((ep) => (
                <li key={ep.id} className="arr-item">
                  <strong>
                    S{String(ep.seasonNumber).padStart(2, "0")}E
                    {String(ep.episodeNumber).padStart(2, "0")} · {ep.title}
                  </strong>
                  <span>
                    {ep.hasFile ? "Downloaded" : "Missing"}
                    {ep.airDate ? ` · ${ep.airDate}` : ""}
                  </span>
                  {!ep.hasFile && (
                    <div className="arr-item-actions">
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() => void onEpisodeSearch(ep)}
                      >
                        Search DL
                      </button>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() => void onEpisodeGrab(ep)}
                      >
                        Grab…
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {releasesFor && (
          <div className="releases">
            <h2>Releases · {releasesFor}</h2>
            <ul className="arr-list">
              {releases.map((release) => (
                <li key={release.guid} className="arr-item">
                  <strong>{release.title}</strong>
                  <span>
                    {[
                      release.quality,
                      formatBytes(release.size),
                      release.indexer,
                      typeof release.seeders === "number"
                        ? `${release.seeders} seeders`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="arr-item-actions">
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy || !release.approved}
                      onClick={() => void onGrab(release)}
                    >
                      Send to DL client
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page arr-page">
      <header className="top compact">
        <div className="top-row">
          <button type="button" className="btn ghost tight" onClick={onBack}>
            ← Back
          </button>
          <div className="arr-title">
            <h1 style={{ color: service.color }}>{service.name}</h1>
            {version ? <p className="sub">v{version}</p> : null}
          </div>
          <button
            type="button"
            className="btn ghost tight"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="tabs tabs-4">
        {(
          [
            ...(searchSupported ? ([["search", "Search"]] as const) : []),
            ["library", `Library (${library.length})`],
            ["queue", `Queue (${queue.length})`],
            ["calendar", `Soon (${calendar.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="err banner">{error}</p>}
      {message && <p className="ok banner">{message}</p>}

      {tab === "search" && (
        <section className="search-panel">
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              type="search"
              enterKeyHint="search"
              placeholder={
                kind === "movie"
                  ? "Search movies…"
                  : kind === "series"
                    ? "Search TV shows…"
                    : "Search…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="btn primary tight"
              disabled={searching || !query.trim()}
            >
              {searching ? "…" : "Go"}
            </button>
          </form>

          <ul className="arr-list">
            {results.map((item) => (
              <li key={item.key} className="arr-item search-item">
                <strong>
                  {item.title}
                  {item.year ? ` (${item.year})` : ""}
                </strong>
                {item.overview ? (
                  <span className="overview">
                    {item.overview.length > 120
                      ? `${item.overview.slice(0, 120)}…`
                      : item.overview}
                  </span>
                ) : null}
                <span className="meta">
                  {item.alreadyAdded ? "In library" : "Not in library"}
                </span>
                <div className="arr-item-actions">
                  <button
                    type="button"
                    className="btn chip"
                    disabled={busy}
                    onClick={() => openLookupPreview(item)}
                  >
                    {kind === "series" ? "Episodes / details" : "Details"}
                  </button>
                  {!item.alreadyAdded ? (
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() => void onAddSearch(item)}
                    >
                      Add + Search
                    </button>
                  ) : kind === "movie" ? (
                    <>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() => void onSearchExisting(item)}
                      >
                        Search DL
                      </button>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() => void onGrabMovieReleases(item)}
                      >
                        Grab…
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "library" && (
        <section className="search-panel">
          <input
            type="search"
            placeholder="Filter library…"
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
          />
          {loading && <p className="hint">Loading library…</p>}
          <ul className="arr-list">
            {!loading && filteredLibrary.length === 0 && (
              <p className="hint empty">Library is empty.</p>
            )}
            {filteredLibrary.map((item) => (
              <li key={item.id} className="arr-item">
                <button
                  type="button"
                  className="library-open"
                  onClick={() => {
                    if (kind === "series") {
                      void openSeriesDetail(item.title, item.id);
                    } else if (kind === "movie") {
                      setDetail({
                        title: item.title,
                        movieId: item.id,
                        lookup: {
                          key: String(item.id),
                          title: item.title,
                          year: item.year,
                          alreadyAdded: true,
                          addedId: item.id,
                          raw: { id: item.id },
                        },
                      });
                    }
                  }}
                >
                  <strong>
                    {item.title}
                    {item.year ? ` (${item.year})` : ""}
                  </strong>
                  <span>
                    {kind === "series" &&
                    item.episodeFileCount != null &&
                    item.episodeCount != null
                      ? `${item.episodeFileCount}/${item.episodeCount} eps`
                      : item.hasFile
                        ? "Has file"
                        : item.status || "In library"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "queue" && !loading && (
        <ul className="arr-list">
          {queue.length === 0 && (
            <p className="hint empty">Download queue is empty.</p>
          )}
          {queue.map((item) => (
            <li key={`q-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {item.status}
                {item.timeleft ? ` · ${item.timeleft}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "calendar" && !loading && (
        <ul className="arr-list">
          {calendar.length === 0 && (
            <p className="hint empty">Nothing upcoming this week.</p>
          )}
          {calendar.map((item) => (
            <li key={`c-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {(item.airDateUtc || item.releaseDate || "")
                  .slice(0, 16)
                  .replace("T", " ")}
                {item.hasFile ? " · has file" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
