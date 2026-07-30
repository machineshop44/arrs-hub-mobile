import { Browser } from "@capacitor/browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";
import { MediaImg } from "./mediaUrl";
import {
  addYtarrSource,
  backfillYtarrSource,
  cancelYtarrQueueJob,
  checkAllYtarrSources,
  checkYtarrSource,
  fetchYtarrDashboard,
  fetchYtarrQueue,
  fetchYtarrSources,
  fetchYtarrVideos,
  formatDurationSeconds,
  formatVideoStatus,
  ignoreYtarrVideo,
  patchYtarrSource,
  pauseYtarrQueue,
  posterUrl,
  processYtarrQueue,
  resumeYtarrQueue,
  retryYtarrQueueJob,
  retryYtarrVideo,
  searchYtarr,
  type YtarrDashboard,
  type YtarrDownloadJob,
  type YtarrSearchHit,
  type YtarrSource,
  type YtarrVideo,
} from "./ytarrApi";

type Tab = "channels" | "search" | "queue" | "history";
type DetailTab = "overview" | "videos";

interface YtarrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

const MONITOR_MODES = [
  { value: "new", label: "Future only" },
  { value: "all", label: "All videos" },
  { value: "none", label: "None" },
] as const;

export function YtarrPanel({
  service,
  onBack,
  onOpenSettings,
}: YtarrPanelProps) {
  const [tab, setTab] = useState<Tab>("channels");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [dashboard, setDashboard] = useState<YtarrDashboard | null>(null);
  const [sources, setSources] = useState<YtarrSource[]>([]);
  const [queue, setQueue] = useState<YtarrDownloadJob[]>([]);
  const [history, setHistory] = useState<YtarrDownloadJob[]>([]);
  const [libraryFilter, setLibraryFilter] = useState("");

  const [selected, setSelected] = useState<YtarrSource | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [videos, setVideos] = useState<YtarrVideo[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<YtarrSearchHit[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, src, activeQ, hist] = await Promise.all([
        fetchYtarrDashboard(service),
        fetchYtarrSources(service),
        fetchYtarrQueue(service, { status: "active", limit: 100 }),
        fetchYtarrQueue(service, { status: "history", limit: 50 }),
      ]);
      setDashboard(dash);
      setSources(src);
      setQueue(activeQ);
      setHistory(hist);
      setSelected((prev) =>
        prev ? (src.find((s) => s.id === prev.id) ?? prev) : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const openChannel = async (source: YtarrSource) => {
    setSelected(source);
    setDetailTab("overview");
    setStatusFilter("all");
    setVideos([]);
    setDetailLoading(true);
    setError(null);
    try {
      setVideos(await fetchYtarrVideos(service, { source_id: source.id, limit: 500 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setVideos([]);
  };

  const filteredSources = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.source_type.toLowerCase().includes(q) ||
        (s.yt_id || "").toLowerCase().includes(q),
    );
  }, [sources, libraryFilter]);

  const filteredVideos = useMemo(() => {
    if (statusFilter === "all") return videos;
    return videos.filter((v) => v.status === statusFilter);
  }, [videos, statusFilter]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await fn();
      setMessage(label);
      await load();
      if (selected) {
        const fresh = (await fetchYtarrSources(service)).find(
          (s) => s.id === selected.id,
        );
        if (fresh) {
          setSelected(fresh);
          setVideos(
            await fetchYtarrVideos(service, { source_id: fresh.id, limit: 500 }),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters to search.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setResults(await searchYtarr(service, q, "channel", 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onAdd = async (hit: YtarrSearchHit) => {
    await runAction(`Added ${hit.title}`, () =>
      addYtarrSource(service, hit.url, "all", {
        title: hit.title,
        yt_id: hit.id,
        thumbnail_url: hit.thumbnail_url,
        channel: hit.channel,
      }),
    );
    setTab("channels");
  };

  const openWebUi = async () => {
    const url = service.url.trim().replace(/\/+$/, "");
    if (!url) return;
    try {
      await Browser.open({ url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (selected) {
    const pct =
      selected.video_count > 0
        ? Math.round((selected.downloaded_count / selected.video_count) * 100)
        : selected.downloaded_count > 0
          ? 100
          : 0;

    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button type="button" className="icon-btn" onClick={closeDetail}>
            ←
          </button>
          <h1>Channel Details</h1>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={() =>
              void runAction("Refreshed channel", () =>
                checkYtarrSource(service, selected.id),
              )
            }
            aria-label="Refresh channel"
          >
            ↻
          </button>
        </header>

        <div className="detail-hero">
          <MediaImg
            src={posterUrl(service, selected.id)}
            className="detail-poster"
          />
          <div>
            <strong>{selected.title}</strong>
            <span className="meta">
              {selected.source_type}
              {selected.media_type ? ` · ${selected.media_type}` : ""}
              {selected.quality ? ` · ${selected.quality}` : ""}
            </span>
            <p>
              {selected.downloaded_count}/{selected.video_count} downloaded (
              {pct}%)
              {selected.wanted_count
                ? ` · ${selected.wanted_count} wanted`
                : ""}
            </p>
          </div>
        </div>

        <div className="detail-tabs">
          <button
            type="button"
            className={detailTab === "overview" ? "active" : ""}
            onClick={() => setDetailTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={detailTab === "videos" ? "active" : ""}
            onClick={() => setDetailTab("videos")}
          >
            Videos ({videos.length})
          </button>
        </div>

        {error && <p className="err banner">{error}</p>}
        {message && <p className="ok banner">{message}</p>}

        {detailTab === "overview" && (
          <>
            <div className="arr-item-actions" style={{ padding: "0.5rem 0.85rem" }}>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    selected.enabled ? "Monitoring off" : "Monitoring on",
                    () =>
                      patchYtarrSource(service, selected.id, {
                        enabled: !selected.enabled,
                      }),
                  )
                }
              >
                {selected.enabled ? "Monitored" : "Unmonitored"}
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() =>
                  void runAction("Scan complete", () =>
                    checkYtarrSource(service, selected.id),
                  )
                }
              >
                Scan / refresh
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() =>
                  void runAction("Backfill queued", () =>
                    backfillYtarrSource(service, selected.id),
                  )
                }
              >
                Backfill
              </button>
            </div>

            <div className="luna-subheader">
              <strong>Monitor mode</strong>
            </div>
            <div className="arr-item-actions" style={{ padding: "0 0.85rem 0.75rem" }}>
              {MONITOR_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={`btn chip${
                    selected.monitor_mode === mode.value ? " primary" : ""
                  }`}
                  disabled={busy || selected.monitor_mode === mode.value}
                  onClick={() =>
                    void runAction(`Mode → ${mode.label}`, () =>
                      patchYtarrSource(service, selected.id, {
                        monitor_mode: mode.value,
                      }),
                    )
                  }
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <ul className="arr-list">
              <li className="arr-item">
                <strong>Status</strong>
                <span className="meta">
                  {selected.enabled ? "Enabled" : "Disabled"} · mode{" "}
                  {selected.monitor_mode}
                  {selected.initialized ? "" : " · initializing"}
                </span>
              </li>
              <li className="arr-item">
                <strong>Last checked</strong>
                <span className="meta">
                  {selected.last_checked
                    ? new Date(selected.last_checked).toLocaleString()
                    : "Never"}
                </span>
              </li>
              <li className="arr-item">
                <strong>URL</strong>
                <span className="meta">{selected.url}</span>
              </li>
            </ul>
          </>
        )}

        {detailTab === "videos" && (
          <>
            <div className="luna-subheader">
              <strong>Episodes / uploads</strong>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All</option>
                <option value="wanted">Wanted</option>
                <option value="queued">Queued</option>
                <option value="downloading">Downloading</option>
                <option value="downloaded">Downloaded</option>
                <option value="failed">Failed</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
            {detailLoading ? (
              <p className="hint">Loading videos…</p>
            ) : filteredVideos.length === 0 ? (
              <div className="empty-card">
                <strong>No videos</strong>
                <p>Scan the channel or change the status filter.</p>
              </div>
            ) : (
              <ul className="arr-list">
                {filteredVideos.map((v) => (
                  <li key={v.id} className="arr-item">
                    <strong>{v.title}</strong>
                    <span className="meta">
                      {[
                        formatVideoStatus(v.status),
                        v.published_at
                          ? new Date(v.published_at).toLocaleDateString()
                          : null,
                        formatDurationSeconds(v.duration),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {v.error && <span className="meta">{v.error}</span>}
                    {(v.status === "failed" ||
                      v.status === "ignored" ||
                      v.status === "wanted") && (
                      <div className="arr-item-actions">
                        {(v.status === "failed" || v.status === "ignored") && (
                          <button
                            type="button"
                            className="btn chip"
                            disabled={busy}
                            onClick={() =>
                              void runAction("Retry queued", () =>
                                retryYtarrVideo(service, v.id),
                              )
                            }
                          >
                            Retry
                          </button>
                        )}
                        {(v.status === "failed" || v.status === "wanted") && (
                          <button
                            type="button"
                            className="btn chip"
                            disabled={busy}
                            onClick={() =>
                              void runAction("Ignored", () =>
                                ignoreYtarrVideo(service, v.id),
                              )
                            }
                          >
                            Ignore
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="ytarr" color={service.color} size={22} />
          Ytarr
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void load()}
          aria-label="Refresh"
        >
          ↻
        </button>
      </header>

      <div className="detail-tabs">
        <button
          type="button"
          className={tab === "channels" ? "active" : ""}
          onClick={() => setTab("channels")}
        >
          Channels
        </button>
        <button
          type="button"
          className={tab === "search" ? "active" : ""}
          onClick={() => setTab("search")}
        >
          Search
        </button>
        <button
          type="button"
          className={tab === "queue" ? "active" : ""}
          onClick={() => setTab("queue")}
        >
          Queue{dashboard?.queue_size ? ` (${dashboard.queue_size})` : ""}
        </button>
        <button
          type="button"
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {message && <p className="ok banner">{message}</p>}
      {loading && <p className="hint">Loading Ytarr…</p>}

      {!loading && dashboard && (
        <p className="hint" style={{ padding: "0 0.85rem 0.25rem" }}>
          {dashboard.enabled_sources}/{dashboard.sources} channels ·{" "}
          {dashboard.wanted} wanted · {dashboard.queue_size} queue
          {dashboard.ytdlp_ok
            ? dashboard.ytdlp_version
              ? ` · yt-dlp ${dashboard.ytdlp_version}`
              : " · yt-dlp ok"
            : " · yt-dlp issue"}
          {" · "}
          <button type="button" className="btn chip" onClick={() => void openWebUi()}>
            Open Web UI
          </button>
        </p>
      )}

      {tab === "channels" && !loading && (
        <>
          <div className="luna-subheader">
            <strong>Library</strong>
            <button
              type="button"
              className="btn chip"
              disabled={busy}
              onClick={() =>
                void runAction("Scanned all channels", () =>
                  checkAllYtarrSources(service),
                )
              }
            >
              {busy ? "Scanning…" : "Scan all"}
            </button>
          </div>
          <form
            className="search-row"
            style={{ padding: "0 0.85rem 0.5rem" }}
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="search"
              placeholder="Filter channels…"
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
          </form>
          {filteredSources.length === 0 ? (
            <div className="empty-card">
              <strong>No channels</strong>
              <p>Use Search to add a YouTube channel or playlist.</p>
            </div>
          ) : (
            <ul className="series-grid">
              {filteredSources.map((item) => {
                const have = item.downloaded_count;
                const total = item.video_count;
                const pct =
                  total > 0 ? Math.round((have / total) * 100) : have > 0 ? 100 : 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="series-card"
                      onClick={() => void openChannel(item)}
                    >
                      <MediaImg src={posterUrl(service, item.id)} />
                      <div className="series-meta">
                        <strong>{item.title}</strong>
                        <span>
                          {have}/{total} ({pct}%)
                          {item.wanted_count ? ` · ${item.wanted_count} wanted` : ""}
                        </span>
                        <span>
                          {item.source_type}
                          {item.enabled ? " · Monitored" : " · Off"}
                          {item.monitor_mode ? ` · ${item.monitor_mode}` : ""}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
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
              placeholder="Search YouTube channels…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="btn primary tight"
              disabled={searching}
            >
              Go
            </button>
          </form>
          <ul className="arr-list">
            {results.map((hit) => (
              <li key={`${hit.kind}:${hit.id || hit.url}`} className="arr-item">
                <strong>{hit.title}</strong>
                <span className="meta">
                  {[hit.kind, hit.channel, hit.video_count != null ? `${hit.video_count} videos` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {hit.description && (
                  <span className="meta">
                    {hit.description.slice(0, 120)}
                    {hit.description.length > 120 ? "…" : ""}
                  </span>
                )}
                <div className="arr-item-actions">
                  <button
                    type="button"
                    className="btn chip"
                    disabled={busy}
                    onClick={() => void onAdd(hit)}
                  >
                    Add &amp; monitor
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!searching && results.length === 0 && query.trim().length >= 2 && (
            <div className="empty-card">
              <strong>No results</strong>
              <p>Try another channel name or paste a channel URL in ytarr Web UI.</p>
            </div>
          )}
        </section>
      )}

      {tab === "queue" && !loading && (
        <>
          <div className="luna-subheader">
            <strong>Activity</strong>
            <div className="arr-item-actions">
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() =>
                  void runAction("Queue paused", () => pauseYtarrQueue(service))
                }
              >
                Pause
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() =>
                  void runAction("Queue resumed", async () => {
                    await resumeYtarrQueue(service);
                    await processYtarrQueue(service);
                  })
                }
              >
                Resume
              </button>
            </div>
          </div>
          {queue.length === 0 ? (
            <div className="empty-card">
              <strong>Queue empty</strong>
              <p>Wanted videos will appear here when downloading.</p>
            </div>
          ) : (
            <ul className="arr-list">
              {queue.map((job) => (
                <li key={job.id} className="arr-item">
                  <strong>{job.video_title || `Video #${job.video_id}`}</strong>
                  <span className="meta">
                    {[
                      job.source_title,
                      job.status,
                      job.progress != null ? `${Math.round(job.progress)}%` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {job.error && <span className="meta">{job.error}</span>}
                  <div className="arr-item-actions">
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() =>
                        void runAction("Cancelled", () =>
                          cancelYtarrQueueJob(service, job.id),
                        )
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "history" && !loading && (
        <>
          <div className="luna-subheader">
            <strong>Recent jobs</strong>
            <span>{history.length} shown</span>
          </div>
          {history.length === 0 ? (
            <div className="empty-card">
              <strong>No history yet</strong>
              <p>Completed, failed, or cancelled downloads show up here.</p>
            </div>
          ) : (
            <ul className="arr-list">
              {history.map((job) => (
                <li key={job.id} className="arr-item">
                  <strong>{job.video_title || `Video #${job.video_id}`}</strong>
                  <span className="meta">
                    {[
                      job.source_title,
                      job.status,
                      job.finished_at
                        ? new Date(job.finished_at).toLocaleString()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {job.error && <span className="meta">{job.error}</span>}
                  {(job.status === "failed" || job.status === "cancelled") && (
                    <div className="arr-item-actions">
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() =>
                          void runAction("Retry queued", () =>
                            retryYtarrQueueJob(service, job.id),
                          )
                        }
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
