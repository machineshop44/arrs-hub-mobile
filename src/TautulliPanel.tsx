import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceIcon } from "./icons";
import { MediaImg } from "./mediaUrl";
import type { ServiceConfig } from "./services";
import {
  fetchTautulliActivity,
  formatBandwidth,
  type TautulliSession,
} from "./tautulliApi";

interface TautulliPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

const POLL_MS = 5000;

function stateIcon(state: string): string {
  const s = state.toLowerCase();
  if (s === "paused") return "⏸";
  if (s === "buffering") return "↻";
  return "▶";
}

function decisionClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("transcode")) return "tp-decision-transcode";
  if (l.includes("stream")) return "tp-decision-stream";
  return "tp-decision-direct";
}

function StreamCard({ session }: { session: TautulliSession }) {
  const progress = Math.min(100, Math.max(0, session.progressPercent));
  const tcProgress = Math.min(100, Math.max(0, session.transcodeProgress));
  const bw = formatBandwidth(session.bandwidthKbps);
  const metaBits = [
    session.quality,
    session.resolution,
    bw,
    session.platform,
    session.location ? session.location.toUpperCase() : "",
  ].filter(Boolean);

  return (
    <li className="tp-stream-card">
      <div className="tp-stream-body">
        <MediaImg
          src={session.posterUrl}
          className="tp-poster"
          fallbackClassName="tp-poster poster-fallback"
          alt=""
        />
        <div className="tp-stream-main">
          <div className="tp-stream-title-row">
            <strong className="tp-title">{session.displayTitle}</strong>
            <span
              className={`tp-state tp-state-${session.state.toLowerCase()}`}
              title={session.state}
              aria-label={session.state}
            >
              {stateIcon(session.state)}
            </span>
          </div>
          {session.subtitle ? (
            <p className="tp-subtitle">{session.subtitle}</p>
          ) : null}
          <div className="tp-user-row">
            <MediaImg
              src={session.userThumbUrl}
              className="tp-avatar"
              fallbackClassName="tp-avatar tp-avatar-fallback"
              alt=""
            />
            <div className="tp-user-meta">
              <span className="tp-user-name">{session.user}</span>
              <span className="tp-player-line">
                {[session.player, session.product].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
          <div className="tp-decision-row">
            <span
              className={`tp-decision ${decisionClass(session.transcodeLabel)}`}
            >
              {session.transcodeLabel}
            </span>
            {metaBits.length > 0 ? (
              <span className="tp-meta-bits">{metaBits.join(" · ")}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="tp-progress-block">
        <div className="tp-progress-track" aria-hidden>
          {session.transcodeLabel === "Transcode" && tcProgress > 0 ? (
            <div
              className="tp-progress-transcode"
              style={{ width: `${tcProgress}%` }}
            />
          ) : null}
          <div className="tp-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="tp-progress-pct">{Math.round(progress)}%</span>
      </div>
    </li>
  );
}

export function TautulliPanel({
  service,
  onBack,
  onOpenSettings,
}: TautulliPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [totalBandwidth, setTotalBandwidth] = useState(0);
  const [sessions, setSessions] = useState<TautulliSession[]>([]);
  const hasLoaded = useRef(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent && hasLoaded.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      if (!silent) setError(null);

      const data = await fetchTautulliActivity(service);
      setStreamCount(data.streamCount);
      setTotalBandwidth(data.totalBandwidthKbps);
      setSessions(data.sessions);
      if (!data.ok) setError(data.message || "Failed to load activity");
      else setError(null);
      hasLoaded.current = true;
      setLoading(false);
      setRefreshing(false);
    },
    [service],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const bwLabel = formatBandwidth(totalBandwidth);

  return (
    <div className="page luna-page tautulli-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="tautulli" color={service.color} size={22} />
          Tautulli
        </h1>
        <button
          type="button"
          className={`icon-btn${refreshing ? " spinning" : ""}`}
          onClick={() => void load()}
          aria-label="Refresh"
        >
          ↻
        </button>
      </header>

      <div className="luna-subheader tp-subheader">
        <strong>Activity</strong>
        <span>
          {streamCount} stream{streamCount === 1 ? "" : "s"}
          {bwLabel ? ` · ${bwLabel}` : ""}
        </span>
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
        <div className="empty-card tp-empty">
          <strong>Nothing playing</strong>
          <p>Active Plex streams will show up here.</p>
        </div>
      )}

      <ul className="arr-list tp-stream-list">
        {sessions.map((session) => (
          <StreamCard key={session.sessionKey} session={session} />
        ))}
      </ul>
    </div>
  );
}
