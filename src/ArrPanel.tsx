import { useCallback, useEffect, useState } from "react";
import {
  fetchArrOverview,
  triggerArrCommand,
  type ArrCalendarItem,
  type ArrQueueItem,
  type ArrWantedItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";

type Tab = "queue" | "wanted" | "calendar";

interface ArrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

export function ArrPanel({ service, onBack }: ArrPanelProps) {
  const [tab, setTab] = useState<Tab>("queue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [wanted, setWanted] = useState<ArrWantedItem[]>([]);
  const [calendar, setCalendar] = useState<ArrCalendarItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!service.apiKey.trim()) {
      setError("Add an API key in Settings for this app.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArrOverview(service);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCommand = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await triggerArrCommand(service, name);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const items =
    tab === "queue" ? queue : tab === "wanted" ? wanted : calendar;

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

      <div className="arr-actions">
        <button
          type="button"
          className="btn chip"
          disabled={busy || !service.apiKey}
          onClick={() => void runCommand("RefreshMonitoredDownloads")}
        >
          Refresh queue
        </button>
        <button
          type="button"
          className="btn chip"
          disabled={busy || !service.apiKey}
          onClick={() =>
            void runCommand(
              service.id === "radarr" || service.id === "whisparr"
                ? "MissingMoviesSearch"
                : service.id === "lidarr"
                  ? "MissingAlbumSearch"
                  : service.id === "readarr"
                    ? "MissingBookSearch"
                    : "MissingEpisodeSearch",
            )
          }
        >
          Search missing
        </button>
      </div>

      <div className="tabs">
        {(
          [
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
      {loading && <p className="hint">Loading…</p>}

      {!loading && items.length === 0 && (
        <p className="hint empty">Nothing in {tab} right now.</p>
      )}

      <ul className="arr-list">
        {tab === "queue" &&
          queue.map((item) => (
            <li key={`q-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {item.status}
                {item.timeleft ? ` · ${item.timeleft}` : ""}
              </span>
            </li>
          ))}
        {tab === "wanted" &&
          wanted.map((item) => (
            <li key={`w-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>{item.status || "Missing"}</span>
            </li>
          ))}
        {tab === "calendar" &&
          calendar.map((item) => (
            <li key={`c-${item.id}`} className="arr-item">
              <strong>{item.title}</strong>
              <span>
                {(item.airDateUtc || item.releaseDate || "").slice(0, 16).replace("T", " ")}
                {item.hasFile ? " · has file" : ""}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
