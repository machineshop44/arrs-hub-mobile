import { useCallback, useEffect, useState } from "react";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";
import { fetchTautulliActivity, type TautulliSession } from "./tautulliApi";

interface TautulliPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

export function TautulliPanel({
  service,
  onBack,
  onOpenSettings,
}: TautulliPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [sessions, setSessions] = useState<TautulliSession[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchTautulliActivity(service);
    setStreamCount(data.streamCount);
    setSessions(data.sessions);
    if (!data.ok) setError(data.message || "Failed to load activity");
    setLoading(false);
  }, [service]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="tautulli" color={service.color} size={22} />
          Tautulli
        </h1>
        <button type="button" className="icon-btn" onClick={() => void load()}>
          ↻
        </button>
      </header>

      <div className="luna-subheader">
        <strong>Plex Activity</strong>
        <span>{streamCount} active</span>
      </div>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {loading && <p className="hint">Loading activity…</p>}

      {!loading && !error && sessions.length === 0 && (
        <div className="empty-card">
          <strong>Nothing playing</strong>
          <p>When someone streams on Plex, it shows up here like Plex Dash.</p>
        </div>
      )}

      <ul className="arr-list">
        {sessions.map((session) => (
          <li key={session.sessionKey} className="activity-card">
            <div className="activity-top">
              <strong>{session.fullTitle}</strong>
              <span className={`state-pill ${session.state}`}>{session.state}</span>
            </div>
            <p>
              {session.user} · {session.player}
            </p>
            <p className="meta">
              {[session.transcode, session.quality].filter(Boolean).join(" · ")}
            </p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, session.progressPercent)}%` }}
              />
            </div>
            <span className="meta">{Math.round(session.progressPercent)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
