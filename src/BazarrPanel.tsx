import { useCallback, useEffect, useState } from "react";
import {
  fetchBazarrHistory,
  fetchBazarrWanted,
  formatMissingLabel,
  searchAndDownloadWanted,
  triggerWantedSearchTasks,
  type BazarrHistoryItem,
  type BazarrWantedItem,
} from "./bazarrApi";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";

type Tab = "wanted" | "history";

interface BazarrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

export function BazarrPanel({
  service,
  onBack,
  onOpenSettings,
}: BazarrPanelProps) {
  const [tab, setTab] = useState<Tab>("wanted");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wanted, setWanted] = useState<BazarrWantedItem[]>([]);
  const [wantedTotal, setWantedTotal] = useState(0);
  const [history, setHistory] = useState<BazarrHistoryItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [w, h] = await Promise.all([
      fetchBazarrWanted(service),
      fetchBazarrHistory(service),
    ]);
    setWanted(w.items);
    setWantedTotal(w.total);
    setHistory(h.items);
    if (!w.ok && !h.ok) {
      setError(w.message || h.message || "Could not reach Bazarr API.");
    } else if (!w.ok && w.message) {
      setError(w.message);
    } else if (!h.ok && h.message) {
      setError(h.message);
    }
    setLoading(false);
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearchItem = async (item: BazarrWantedItem) => {
    setBusyKey(item.key);
    setMessage(null);
    const result = await searchAndDownloadWanted(service, item);
    setMessage(result.message);
    setBusyKey(null);
    if (result.ok) {
      // Refresh after a short delay so Bazarr can update wanted/history.
      window.setTimeout(() => void load(), 1500);
    }
  };

  const onSearchAll = async () => {
    setTaskBusy(true);
    setMessage(null);
    const result = await triggerWantedSearchTasks(service);
    setMessage(result.message);
    setTaskBusy(false);
  };

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="bazarr" color={service.color} size={22} />
          Bazarr
        </h1>
        <button type="button" className="icon-btn" onClick={() => void load()}>
          ↻
        </button>
      </header>

      <div className="detail-tabs">
        <button
          type="button"
          className={tab === "wanted" ? "active" : ""}
          onClick={() => setTab("wanted")}
        >
          Wanted{wantedTotal ? ` (${wantedTotal})` : ""}
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
      {loading && <p className="hint">Loading Bazarr…</p>}

      {tab === "wanted" && !loading && (
        <>
          <div className="luna-subheader">
            <strong>Missing subtitles</strong>
            <button
              type="button"
              className="btn chip"
              disabled={taskBusy || !service.apiKey.trim()}
              onClick={() => void onSearchAll()}
            >
              {taskBusy ? "Queuing…" : "Search all"}
            </button>
          </div>
          <p className="hint" style={{ padding: "0 0.85rem 0.35rem" }}>
            MVP native panel: wanted list + per-item search/download (best
            provider match) and Bazarr&apos;s built-in missing searches. No
            series browser, blacklist, or provider settings yet — use the web UI
            for those.
          </p>
          {wanted.length === 0 ? (
            <div className="empty-card">
              <strong>Nothing wanted</strong>
              <p>No episodes or movies are missing configured subtitle languages.</p>
            </div>
          ) : (
            <ul className="arr-list">
              {wanted.map((item) => (
                <li key={item.key} className="arr-item">
                  {item.kind === "episode" ? (
                    <>
                      <strong>{item.seriesTitle}</strong>
                      <span>
                        {item.episodeNumber}
                        {item.episodeTitle ? ` · ${item.episodeTitle}` : ""}
                      </span>
                    </>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <span className="meta">
                    {item.kind === "episode" ? "Series" : "Movie"} · missing{" "}
                    {formatMissingLabel(item)}
                  </span>
                  <div className="arr-item-actions">
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busyKey === item.key}
                      onClick={() => void onSearchItem(item)}
                    >
                      {busyKey === item.key ? "Searching…" : "Search & download"}
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
            <strong>Recent activity</strong>
            <span>{history.length} shown</span>
          </div>
          {history.length === 0 ? (
            <div className="empty-card">
              <strong>No history yet</strong>
              <p>Downloaded or failed subtitle events will show up here.</p>
            </div>
          ) : (
            <ul className="arr-list">
              {history.map((item) => (
                <li key={item.key} className="arr-item">
                  <strong>{item.title}</strong>
                  {item.subtitle && <span>{item.subtitle}</span>}
                  <span className="meta">
                    {[
                      item.kind === "episode" ? "Series" : "Movie",
                      item.language,
                      item.provider,
                      item.timestamp,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {item.description && (
                    <span className="meta">{item.description}</span>
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
