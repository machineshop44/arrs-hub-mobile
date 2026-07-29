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
  type ArrWantedItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";
import { ServiceIcon } from "./icons";

type Tab = "library" | "search" | "calendar" | "missing" | "queue";
type DetailTab = "overview" | "episodes";

interface ArrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

export function ArrPanel({ service, onBack }: ArrPanelProps) {
  const kind = detectArrKind(service);
  const searchSupported = kind !== "unknown";

  const [tab, setTab] = useState<Tab>("library");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [wanted, setWanted] = useState<ArrWantedItem[]>([]);
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

  const [selected, setSelected] = useState<ArrLibraryItem | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [episodes, setEpisodes] = useState<ArrEpisodeItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<number | "all">("all");
  const [lookupPreview, setLookupPreview] = useState<ArrLookupItem | null>(
    null,
  );

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
        setError(data.errors[0] || "Could not reach the API.");
      }
      setQueue(data.queue);
      setWanted(data.wanted ?? []);
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

  const openLibraryItem = async (item: ArrLibraryItem) => {
    setSelected(item);
    setLookupPreview(null);
    setDetailTab("overview");
    setSeasonFilter("all");
    setReleases([]);
    setReleasesFor(null);
    if (kind !== "series") return;
    setDetailLoading(true);
    try {
      setEpisodes(await fetchSeriesEpisodes(service, item.id));
    } catch (err) {
      setEpisodes([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
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
    try {
      setMessage(await addAndSearch(service, item, profiles));
      await load();
      setTab("library");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGrab = async (release: { guid: string } & ArrReleaseItem) => {
    setBusy(true);
    try {
      setMessage(await grabRelease(service, release));
      await load();
      setTab("queue");
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (selected || lookupPreview) {
    const item = selected;
    const previewSeasons = lookupPreview
      ? seasonsFromLookup(lookupPreview)
      : [];
    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setSelected(null);
              setLookupPreview(null);
              setEpisodes([]);
              setReleases([]);
            }}
          >
            ←
          </button>
          <h1>Series Details</h1>
          <span />
        </header>

        <div className="detail-hero">
          {item?.posterUrl ? (
            <img src={item.posterUrl} alt="" className="detail-poster" />
          ) : (
            <div className="detail-poster placeholder" />
          )}
          <div>
            <strong>{item?.title || lookupPreview?.title}</strong>
            <p>
              {(item?.overview || lookupPreview?.overview || "").slice(0, 160)}
              {(item?.overview || lookupPreview?.overview || "").length > 160
                ? "…"
                : ""}
            </p>
          </div>
        </div>

        {item && (
          <div className="detail-tabs">
            <button
              type="button"
              className={detailTab === "overview" ? "active" : ""}
              onClick={() => setDetailTab("overview")}
            >
              Overview
            </button>
            {kind === "series" && (
              <button
                type="button"
                className={detailTab === "episodes" ? "active" : ""}
                onClick={() => setDetailTab("episodes")}
              >
                Episodes
              </button>
            )}
          </div>
        )}

        {error && <p className="err banner">{error}</p>}
        {message && <p className="ok banner">{message}</p>}

        {lookupPreview && !item && (
          <>
            <div className="arr-item-actions">
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() => void onAddSearch(lookupPreview)}
              >
                Add + Search
              </button>
            </div>
            {previewSeasons.length > 0 && (
              <ul className="arr-list">
                {previewSeasons.map((s) => (
                  <li key={s.seasonNumber} className="arr-item">
                    <strong>
                      {s.seasonNumber === 0
                        ? "Specials"
                        : `Season ${s.seasonNumber}`}
                    </strong>
                    <span>
                      {s.episodeCount != null
                        ? `${s.episodeCount} episodes`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {item && detailTab === "overview" && (
          <div className="detail-grid">
            <div>
              <span>MONITORING</span>
              <strong>{item.monitored ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>PATH</span>
              <strong>{item.path || "—"}</strong>
            </div>
            <div>
              <span>QUALITY</span>
              <strong>{item.qualityProfile || "—"}</strong>
            </div>
            <div>
              <span>STATUS</span>
              <strong>{item.status || "—"}</strong>
            </div>
            <div>
              <span>NEXT AIRING</span>
              <strong>
                {item.nextAiring
                  ? item.nextAiring.slice(0, 16).replace("T", " ")
                  : item.status === "ended"
                    ? "Series Ended"
                    : "—"}
              </strong>
            </div>
            <div>
              <span>YEAR</span>
              <strong>{item.year || "—"}</strong>
            </div>
            <div>
              <span>NETWORK</span>
              <strong>{item.network || "—"}</strong>
            </div>
            <div>
              <span>RUNTIME</span>
              <strong>
                {item.runtime ? `${item.runtime}m` : "—"}
              </strong>
            </div>
            <div>
              <span>RATING</span>
              <strong>{item.certification || "—"}</strong>
            </div>
            <div>
              <span>GENRES</span>
              <strong>{item.genres?.join(", ") || "—"}</strong>
            </div>
            <div>
              <span>ADDED ON</span>
              <strong>
                {item.added
                  ? new Date(item.added).toLocaleDateString()
                  : "—"}
              </strong>
            </div>
            {kind === "movie" && (
              <div className="arr-item-actions">
                <button
                  type="button"
                  className="btn chip"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setMessage(
                        await searchExisting(service, {
                          key: String(item.id),
                          title: item.title,
                          alreadyAdded: true,
                          addedId: item.id,
                          raw: { id: item.id },
                        }),
                      );
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Search DL
                </button>
                <button
                  type="button"
                  className="btn chip"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const list = await fetchReleasesForLookup(service, {
                        key: String(item.id),
                        title: item.title,
                        alreadyAdded: true,
                        addedId: item.id,
                        raw: { id: item.id },
                      });
                      setReleasesFor(item.title);
                      setReleases(list);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Grab…
                </button>
              </div>
            )}
          </div>
        )}

        {item && detailTab === "episodes" && (
          <>
            {detailLoading && <p className="hint">Loading episodes…</p>}
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
                        onClick={async () => {
                          setBusy(true);
                          try {
                            setMessage(
                              await searchEpisode(service, [ep.id]),
                            );
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : String(err),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Search DL
                      </button>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const list = await fetchEpisodeReleases(
                              service,
                              ep.id,
                            );
                            setReleasesFor(
                              `S${ep.seasonNumber}E${ep.episodeNumber}`,
                            );
                            setReleases(list);
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : String(err),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
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
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="arr-item-actions">
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
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
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack}>
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id={service.id} color={service.color} size={22} />
          {service.name}
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setTab("search")}
        >
          +
        </button>
      </header>

      {tab === "library" && (
        <div className="library-toolbar">
          <input
            type="search"
            placeholder="Search…"
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
          />
        </div>
      )}

      {error && <p className="err banner">{error}</p>}
      {message && <p className="ok banner">{message}</p>}

      {tab === "library" && (
        <ul className="series-list">
          {loading && <p className="hint">Loading library…</p>}
          {!loading &&
            filteredLibrary.map((item) => {
              const have = item.episodeFileCount ?? (item.hasFile ? 1 : 0);
              const total = item.episodeCount ?? (item.hasFile ? 1 : 0);
              const pct =
                item.percentOfEpisodes ??
                (total > 0 ? Math.round((have / total) * 100) : item.hasFile ? 100 : 0);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="series-card"
                    style={
                      item.fanartUrl
                        ? {
                            backgroundImage: `linear-gradient(90deg, rgba(12,16,20,.92), rgba(12,16,20,.55)), url(${item.fanartUrl})`,
                          }
                        : undefined
                    }
                    onClick={() => void openLibraryItem(item)}
                  >
                    {item.posterUrl ? (
                      <img src={item.posterUrl} alt="" />
                    ) : (
                      <div className="poster-fallback" />
                    )}
                    <div className="series-meta">
                      <strong>{item.title}</strong>
                      <span>
                        {kind === "series"
                          ? `${have}/${total} (${pct}%)`
                          : item.hasFile
                            ? "Downloaded"
                            : "Missing"}
                      </span>
                      <span>
                        {kind === "series" && item.seasonCount
                          ? `${item.seasonCount} Seasons`
                          : item.year || ""}
                        {item.sizeOnDisk
                          ? ` · ${formatBytes(item.sizeOnDisk)}`
                          : ""}
                      </span>
                      <span>
                        {[item.qualityProfile || "Any", "Any"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span>
                        {[item.network, item.status].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
        </ul>
      )}

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
              placeholder={kind === "movie" ? "Search movies…" : "Search shows…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn primary tight" disabled={searching}>
              Go
            </button>
          </form>
          <ul className="arr-list">
            {results.map((item) => (
              <li key={item.key} className="arr-item">
                <strong>
                  {item.title}
                  {item.year ? ` (${item.year})` : ""}
                </strong>
                <span className="meta">
                  {item.alreadyAdded ? "In library" : "Not in library"}
                </span>
                <div className="arr-item-actions">
                  <button
                    type="button"
                    className="btn chip"
                    onClick={() => {
                      if (item.alreadyAdded && item.addedId) {
                        const lib = library.find((l) => l.id === item.addedId);
                        if (lib) void openLibraryItem(lib);
                        else setLookupPreview(item);
                      } else {
                        setLookupPreview(item);
                      }
                    }}
                  >
                    Details
                  </button>
                  {!item.alreadyAdded && (
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() => void onAddSearch(item)}
                    >
                      Add + Search
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "calendar" && (
        <ul className="arr-list">
          {calendar.map((item) => (
            <li key={item.id} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {(item.airDateUtc || item.releaseDate || "")
                  .slice(0, 16)
                  .replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "missing" && (
        <ul className="arr-list">
          {wanted.length === 0 && (
            <p className="hint empty">Nothing missing right now.</p>
          )}
          {wanted.map((item) => (
            <li key={item.id} className="arr-item">
              <strong>{item.title}</strong>
              <span>{item.status || "Missing"}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === "queue" && (
        <ul className="arr-list">
          {queue.map((item) => (
            <li key={item.id} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {item.status}
                {item.timeleft ? ` · ${item.timeleft}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <nav className="luna-bottom arr-bottom">
        <button
          type="button"
          className={tab === "library" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("library")}
        >
          Series
        </button>
        <button
          type="button"
          className={tab === "calendar" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("calendar")}
        >
          📅
        </button>
        <button
          type="button"
          className={tab === "missing" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("missing")}
        >
          Missing
        </button>
        <button
          type="button"
          className={tab === "queue" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("queue")}
        >
          Queue
        </button>
        <button
          type="button"
          className={tab === "search" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("search")}
        >
          ⋯
        </button>
      </nav>
    </div>
  );
}
