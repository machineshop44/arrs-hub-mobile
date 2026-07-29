import { useCallback, useEffect, useState } from "react";
import {
  addAndSearch,
  detectArrKind,
  fetchAddProfiles,
  fetchArrOverview,
  fetchReleasesForLookup,
  formatBytes,
  grabRelease,
  lookupMedia,
  searchExisting,
  type ArrAddProfile,
  type ArrCalendarItem,
  type ArrLookupItem,
  type ArrQueueItem,
  type ArrReleaseItem,
  type ArrWantedItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";

type Tab = "search" | "queue" | "wanted" | "calendar";

interface ArrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

export function ArrPanel({ service, onBack }: ArrPanelProps) {
  const kind = detectArrKind(service);
  const searchSupported = kind !== "unknown";

  const [tab, setTab] = useState<Tab>(searchSupported ? "search" : "queue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [wanted, setWanted] = useState<ArrWantedItem[]>([]);
  const [calendar, setCalendar] = useState<ArrCalendarItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ArrLookupItem[]>([]);
  const [profiles, setProfiles] = useState<ArrAddProfile | null>(null);
  const [releasesFor, setReleasesFor] = useState<ArrLookupItem | null>(null);
  const [releases, setReleases] = useState<ArrReleaseItem[]>([]);

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
      setWanted(data.wanted);
      setCalendar(data.calendar);
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

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    setReleases([]);
    setReleasesFor(null);
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
      const msg = await searchExisting(service, item);
      setMessage(msg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onShowReleases = async (item: ArrLookupItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const list = await fetchReleasesForLookup(service, item);
      setReleasesFor(item);
      setReleases(list);
      if (!list.length) setMessage("No releases found from indexers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReleases([]);
      setReleasesFor(null);
    } finally {
      setBusy(false);
    }
  };

  const onGrab = async (release: ArrReleaseItem) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const msg = await grabRelease(service, release);
      setMessage(msg);
      await load();
      setTab("queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
            ["queue", `Queue (${queue.length})`],
            ["wanted", `Missing (${wanted.length})`],
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
          <p className="hint">
            Search indexers via {service.name}, add to library, and send to your
            download client — same idea as LunaSea.
          </p>

          <ul className="arr-list">
            {results.map((item) => (
              <li key={item.key} className="arr-item search-item">
                <strong>
                  {item.title}
                  {item.year ? ` (${item.year})` : ""}
                </strong>
                {item.overview ? (
                  <span className="overview">
                    {item.overview.length > 140
                      ? `${item.overview.slice(0, 140)}…`
                      : item.overview}
                  </span>
                ) : null}
                <span className="meta">
                  {item.alreadyAdded ? "In library" : "Not in library"}
                </span>
                <div className="arr-item-actions">
                  {!item.alreadyAdded ? (
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() => void onAddSearch(item)}
                    >
                      Add + Search
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() => void onSearchExisting(item)}
                      >
                        Search DL
                      </button>
                      {(kind === "series" || kind === "movie") && (
                        <button
                          type="button"
                          className="btn chip"
                          disabled={busy}
                          onClick={() => void onShowReleases(item)}
                        >
                          Grab…
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {releasesFor && (
            <div className="releases">
              <h2>Releases · {releasesFor.title}</h2>
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
        </section>
      )}

      {tab !== "search" && loading && <p className="hint">Loading…</p>}

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

      {tab === "wanted" && !loading && (
        <ul className="arr-list">
          {wanted.length === 0 && (
            <p className="hint empty">Nothing missing right now.</p>
          )}
          {wanted.map((item) => (
            <li key={`w-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>{item.status || "Missing"}</span>
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
