import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { useAndroidBackHandler } from "./androidBack";
import { ServiceIcon } from "./icons";
import {
  denyOmbiRequestDirect,
  fetchOmbiRequests,
  fetchOmbiTvSeasons,
  ombiHitStatusLabel,
  ombiKindLabel,
  ombiRequestStatusLabel,
  requestOmbiMedia,
  searchOmbi,
  type OmbiRequestRow,
  type OmbiSearchHit,
  type OmbiSearchMode,
  type OmbiSeason,
  type OmbiTvRequestScope,
} from "./ombiApi";
import type { ServiceConfig } from "./services";

interface OmbiPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

const MODE_OPTIONS: { id: OmbiSearchMode; label: string }[] = [
  { id: "media", label: "Movies & TV" },
  { id: "music", label: "Music" },
];

export function OmbiPanel({
  service,
  onBack,
  onOpenSettings,
}: OmbiPanelProps) {
  const [mode, setMode] = useState<OmbiSearchMode>("media");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OmbiSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"search" | "requests">("search");
  const [requests, setRequests] = useState<OmbiRequestRow[] | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [seasonPick, setSeasonPick] = useState<{
    hit: OmbiSearchHit;
    seasons: OmbiSeason[] | null;
    selected: number[];
  } | null>(null);

  useAndroidBackHandler(() => {
    if (seasonPick) {
      setSeasonPick(null);
      return true;
    }
    onBack();
    return true;
  });

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    setError(null);
    try {
      setRequests(await fetchOmbiRequests(service));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequestsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (view === "requests" && requests == null && service.url.trim() && service.apiKey.trim()) {
      void loadRequests();
    }
  }, [view, requests, loadRequests, service.url, service.apiKey]);

  const onDeny = async (row: OmbiRequestRow) => {
    if (busyKey) return;
    if (!window.confirm(`Deny “${row.title}”?`)) return;
    setBusyKey(row.key);
    setError(null);
    try {
      await denyOmbiRequestDirect(service, { type: row.kind, id: row.id });
      setMessage(`Denied “${row.title}”.`);
      setRequests((prev) =>
        prev?.map((r) => (r.key === row.key ? { ...r, status: "denied" } : r)) ?? prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const openSeasonPicker = async (hit: OmbiSearchHit) => {
    setSeasonPick({ hit, seasons: null, selected: [] });
    try {
      const seasons = await fetchOmbiTvSeasons(service, hit);
      setSeasonPick((prev) => (prev && prev.hit.key === hit.key ? { ...prev, seasons } : prev));
    } catch {
      setSeasonPick((prev) => (prev && prev.hit.key === hit.key ? { ...prev, seasons: [] } : prev));
    }
  };

  useEffect(() => {
    setResults([]);
    setError(null);
    setMessage(null);
  }, [mode]);

  const configured = Boolean(service.url.trim() && service.apiKey.trim());

  const runSearch = async () => {
    if (!configured) {
      setError("Set Ombi URL + API key in Settings first.");
      return;
    }
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      const hits = await searchOmbi(service, mode, query);
      setResults(hits);
      if (!hits.length) {
        setMessage(
          mode === "music"
            ? "No albums/artists — check Lidarr is enabled in Ombi, or try an album title."
            : "No results — try a different title.",
        );
      }
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const onRequest = async (hit: OmbiSearchHit, tvScope?: OmbiTvRequestScope) => {
    if (busyKey) return;
    setBusyKey(hit.key);
    setError(null);
    setMessage(null);
    try {
      const msg = await requestOmbiMedia(service, hit, tvScope);
      setMessage(msg);
      setSeasonPick(null);
      setRequests(null);
      setResults((prev) =>
        prev.map((row) =>
          row.key === hit.key ? { ...row, requested: true } : row,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const openOmbiWeb = async () => {
    const url = service.url.trim();
    if (!url) {
      setError("Ombi URL is not set.");
      return;
    }
    try {
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="ombi" color={service.color} size={22} />
          Ombi
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>

      <p className="hint" style={{ margin: "0.35rem 1rem 0" }}>
        Movies &amp; TV share one search (like Ombi). Music searches Lidarr
        albums. Pending approvals stay on the home Ombi chip.
      </p>

      {!configured && (
        <div className="err banner">
          Ombi URL + API key required.{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}

      {error && <div className="err banner">{error}</div>}
      {message && !error && <div className="ok banner">{message}</div>}

      <div className="photo-dump-toolbar" style={{ margin: "0.65rem 1rem 0" }}>
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`btn chip${view === "search" && mode === opt.id ? " primary" : ""}`}
            disabled={searching}
            onClick={() => {
              setView("search");
              setMode(opt.id);
            }}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          className={`btn chip${view === "requests" ? " primary" : ""}`}
          disabled={!configured}
          onClick={() => {
            setView("requests");
            setError(null);
            setMessage(null);
          }}
        >
          Requests
        </button>
        <button
          type="button"
          className="btn chip"
          onClick={() => void openOmbiWeb()}
          disabled={!service.url.trim()}
        >
          Open Ombi web
        </button>
      </div>

      {view === "requests" && (
        <section className="search-panel" style={{ padding: "0.65rem 1rem 1rem" }}>
          <div className="arr-item-actions" style={{ marginBottom: "0.5rem" }}>
            <button
              type="button"
              className="btn chip"
              disabled={requestsLoading}
              onClick={() => void loadRequests()}
            >
              {requestsLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {requests && requests.length === 0 && !requestsLoading && (
            <p className="hint">No requests yet.</p>
          )}
          <ul className="arr-list ombi-search-list">
            {(requests ?? []).map((row) => (
              <li key={row.key} className="arr-item ombi-search-item">
                {row.posterUrl ? (
                  <img className="ombi-search-poster" src={row.posterUrl} alt="" loading="lazy" />
                ) : (
                  <span className="ombi-search-poster placeholder" aria-hidden>
                    {row.kind === "movie" ? "🎬" : row.kind === "tv" ? "📺" : "🎵"}
                  </span>
                )}
                <div className="ombi-search-body">
                  <strong>
                    <span className="ombi-kind-badge">{ombiKindLabel(row.kind)}</span>{" "}
                    {row.title}
                  </strong>
                  <span className="meta">
                    {[
                      row.subtitle,
                      row.requestedBy && `by ${row.requestedBy}`,
                      row.requestedAt &&
                        new Date(row.requestedAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className={`ombi-req-status ${row.status}`}>
                    {ombiRequestStatusLabel(row.status)}
                    {row.deniedReason ? ` — ${row.deniedReason}` : ""}
                  </span>
                  {row.status === "pending" && (
                    <div className="arr-item-actions">
                      <button
                        type="button"
                        className="btn chip danger"
                        disabled={busyKey != null}
                        onClick={() => void onDeny(row)}
                      >
                        {busyKey === row.key ? "Denying…" : "Deny"}
                      </button>
                      <span className="hint" style={{ padding: 0 }}>
                        Approve from the home Ombi chip
                      </span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {seasonPick && (
        <div className="dash-sheet-scrim" onClick={() => setSeasonPick(null)}>
          <div className="dash-sheet ombi-season-sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dash-sheet-head">
              <strong>Request “{seasonPick.hit.title}”</strong>
            </div>
            <div className="arr-item-actions" style={{ flexWrap: "wrap" }}>
              {(["all", "first", "latest"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="btn chip primary"
                  disabled={busyKey != null}
                  onClick={() => void onRequest(seasonPick.hit, { type })}
                >
                  {type === "all" ? "All seasons" : type === "first" ? "First season" : "Latest season"}
                </button>
              ))}
            </div>
            {seasonPick.seasons == null ? (
              <p className="hint">Loading seasons…</p>
            ) : seasonPick.seasons.length === 0 ? (
              <p className="hint">Ombi didn’t return a season list — use a quick option above.</p>
            ) : (
              <>
                <ul className="ombi-season-list">
                  {seasonPick.seasons.map((s) => {
                    const locked = s.available || s.requested;
                    const checked = seasonPick.selected.includes(s.seasonNumber);
                    return (
                      <li key={s.seasonNumber}>
                        <label>
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={checked}
                            onChange={() =>
                              setSeasonPick((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      selected: checked
                                        ? prev.selected.filter((n) => n !== s.seasonNumber)
                                        : [...prev.selected, s.seasonNumber],
                                    }
                                  : prev,
                              )
                            }
                          />
                          Season {s.seasonNumber}
                          <span className="meta">
                            {s.available
                              ? " · available"
                              : s.requested
                                ? " · requested"
                                : s.episodeNumbers.length
                                  ? ` · ${s.episodeNumbers.length} eps`
                                  : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busyKey != null || seasonPick.selected.length === 0}
                  onClick={() =>
                    void onRequest(seasonPick.hit, {
                      type: "seasons",
                      seasons: (seasonPick.seasons ?? []).filter((s) =>
                        seasonPick.selected.includes(s.seasonNumber),
                      ),
                    })
                  }
                >
                  {busyKey === seasonPick.hit.key
                    ? "Requesting…"
                    : `Request ${seasonPick.selected.length || ""} selected`}
                </button>
              </>
            )}
            <button type="button" className="btn" onClick={() => setSeasonPick(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {view === "search" && (
      <section className="search-panel" style={{ padding: "0.65rem 1rem 1rem" }}>
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
              mode === "music"
                ? "Search albums or artists…"
                : "Search movies & TV…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!configured || searching}
          />
          <button
            type="submit"
            className="btn primary tight"
            disabled={!configured || searching || query.trim().length < 2}
          >
            {searching ? "…" : "Go"}
          </button>
        </form>

        <ul className="arr-list ombi-search-list">
          {results.map((hit) => {
            const status = ombiHitStatusLabel(hit);
            const canRequest =
              !hit.available &&
              !hit.requested &&
              !hit.approved &&
              (hit.kind !== "music" || Boolean(hit.foreignAlbumId));
            return (
              <li key={hit.key} className="arr-item ombi-search-item">
                {hit.posterUrl ? (
                  <img
                    className="ombi-search-poster"
                    src={hit.posterUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="ombi-search-poster placeholder" aria-hidden>
                    {hit.kind === "movie"
                      ? "🎬"
                      : hit.kind === "tv"
                        ? "📺"
                        : "🎵"}
                  </span>
                )}
                <div className="ombi-search-body">
                  <strong>
                    <span className="ombi-kind-badge">{ombiKindLabel(hit.kind)}</span>{" "}
                    {hit.title}
                    {hit.year ? ` (${hit.year})` : ""}
                  </strong>
                  <span className="meta">{status}</span>
                  {hit.overview ? (
                    <p className="ombi-search-overview">{hit.overview}</p>
                  ) : null}
                  <div className="arr-item-actions">
                    {canRequest ? (
                      <button
                        type="button"
                        className="btn primary chip"
                        disabled={busyKey != null}
                        onClick={() =>
                          hit.kind === "tv" ? void openSeasonPicker(hit) : void onRequest(hit)
                        }
                      >
                        {busyKey === hit.key ? "Requesting…" : "Request"}
                      </button>
                    ) : hit.kind === "music" && !hit.foreignAlbumId ? (
                      <span className="hint" style={{ padding: 0 }}>
                        Artist only — search an album title, or use Ombi web
                      </span>
                    ) : (
                      <span className="hint" style={{ padding: 0 }}>
                        {status}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      )}
    </div>
  );
}
