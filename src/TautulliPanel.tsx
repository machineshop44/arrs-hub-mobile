import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveInterval } from "./appActive";
import { ServiceIcon } from "./icons";
import { MediaImg } from "./mediaUrl";
import {
  fetchPlexLibraries,
  scanPlexLibrary,
  scanAllPlexLibraries,
  type PlexLibrary,
} from "./plexApi";
import type { ServiceConfig } from "./services";
import {
  fetchTautulliActivity,
  fetchTautulliRecentlyAdded,
  formatBandwidth,
  terminateTautulliSession,
  type TautulliRecentItem,
  type TautulliSession,
} from "./tautulliApi";

interface TautulliPanelProps {
  service: ServiceConfig;
  /** Plex service (token) for library scans; optional. */
  plexService?: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

const POLL_MS = 5000;

type Tab = "activity" | "recent" | "libraries";

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

function relativeTime(ms?: number): string {
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StreamCard({
  session,
  stopping,
  onStop,
}: {
  session: TautulliSession;
  stopping: boolean;
  onStop: (session: TautulliSession) => void;
}) {
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
          {session.transcodeReasons.length > 0 ? (
            <ul className="tp-reasons">
              {session.transcodeReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="tp-progress-block">
        <div className="tp-progress-track" aria-hidden>
          {session.isTranscoding && tcProgress > 0 ? (
            <div
              className="tp-progress-transcode"
              style={{ width: `${tcProgress}%` }}
            />
          ) : null}
          <div className="tp-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="tp-progress-pct">{Math.round(progress)}%</span>
      </div>
      <div className="arr-item-actions">
        <button
          type="button"
          className="btn chip danger"
          disabled={stopping}
          onClick={() => onStop(session)}
        >
          {stopping ? "Stopping…" : "Stop stream"}
        </button>
      </div>
    </li>
  );
}

export function TautulliPanel({
  service,
  plexService,
  onBack,
  onOpenSettings,
}: TautulliPanelProps) {
  const [tab, setTab] = useState<Tab>("activity");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [totalBandwidth, setTotalBandwidth] = useState(0);
  const [sessions, setSessions] = useState<TautulliSession[]>([]);
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<TautulliRecentItem[] | null>(null);
  const [libraries, setLibraries] = useState<PlexLibrary[] | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
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
  }, [load]);

  useActiveInterval(
    () => void load({ silent: true }),
    tab === "activity" ? POLL_MS : null,
  );

  useEffect(() => {
    if (tab !== "recent" || recent) return;
    fetchTautulliRecentlyAdded(service, 30)
      .then(setRecent)
      .catch((err) => {
        setRecent([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, recent, service]);

  useEffect(() => {
    if (tab !== "libraries" || libraries || !plexService) return;
    fetchPlexLibraries(plexService)
      .then(setLibraries)
      .catch((err) => {
        setLibraries([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, libraries, plexService]);

  const stopStream = async (session: TautulliSession) => {
    const ok = window.confirm(
      `Stop ${session.user}'s stream of “${session.displayTitle}”?`,
    );
    if (!ok) return;
    setStoppingKey(session.sessionKey);
    setError(null);
    try {
      await terminateTautulliSession(
        service,
        session,
        "Your stream was stopped by the server owner.",
      );
      setMessage(`Stopped ${session.user}'s stream.`);
      void load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoppingKey(null);
    }
  };

  const scan = async (lib: PlexLibrary | "all") => {
    if (!plexService) return;
    setScanning(lib === "all" ? "all" : lib.key);
    setError(null);
    try {
      if (lib === "all") {
        const n = await scanAllPlexLibraries(plexService);
        setMessage(`Scanning ${n} Plex librar${n === 1 ? "y" : "ies"}.`);
      } else {
        await scanPlexLibrary(plexService, lib.key);
        setMessage(`Scanning “${lib.title}”.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(null);
    }
  };

  const bwLabel = formatBandwidth(totalBandwidth);
  const transcodes = sessions.filter((s) => s.isTranscoding).length;
  const plexReady = Boolean(plexService?.url.trim() && plexService.apiKey.trim());

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
          onClick={() => {
            if (tab === "recent") setRecent(null);
            else if (tab === "libraries") setLibraries(null);
            else void load();
          }}
          aria-label="Refresh"
        >
          ↻
        </button>
      </header>

      <div className="luna-subheader tp-subheader">
        <strong>Activity</strong>
        <span>
          {streamCount} stream{streamCount === 1 ? "" : "s"}
          {transcodes ? ` · ${transcodes} transcoding` : ""}
          {bwLabel ? ` · ${bwLabel}` : ""}
        </span>
      </div>

      <div className="photo-dump-toolbar" style={{ margin: "0.5rem 1rem 0" }}>
        {(
          [
            ["activity", "Now playing"],
            ["recent", "Recently added"],
            ["libraries", "Plex libraries"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn chip${tab === id ? " primary" : ""}`}
            onClick={() => {
              setTab(id);
              setMessage(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {message && !error && <div className="ok banner">{message}</div>}

      {tab === "activity" && (
        <>
          {loading && <p className="hint">Loading activity…</p>}
          {!loading && !error && sessions.length === 0 && (
            <div className="empty-card tp-empty">
              <strong>Nothing playing</strong>
              <p>Active Plex streams will show up here.</p>
            </div>
          )}
          <ul className="arr-list tp-stream-list">
            {sessions.map((session) => (
              <StreamCard
                key={session.sessionKey}
                session={session}
                stopping={stoppingKey === session.sessionKey}
                onStop={(s) => void stopStream(s)}
              />
            ))}
          </ul>
        </>
      )}

      {tab === "recent" && (
        <>
          {!recent && <p className="hint">Loading recently added…</p>}
          {recent && recent.length === 0 && !error && (
            <p className="hint">Nothing added recently.</p>
          )}
          <ul className="tp-recent-grid">
            {(recent ?? []).map((item) => (
              <li key={item.key} className="tp-recent-item">
                <MediaImg
                  src={item.posterUrl}
                  className="tp-recent-poster"
                  fallbackClassName="tp-recent-poster poster-fallback"
                  alt=""
                />
                <strong>{item.title}</strong>
                <span className="meta">
                  {[item.subtitle, relativeTime(item.addedAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "libraries" && (
        <section style={{ padding: "0.65rem 1rem" }}>
          {!plexReady ? (
            <p className="hint">
              Add your Plex URL and token under Settings → Plex to scan libraries.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn primary chip"
                disabled={scanning != null}
                onClick={() => void scan("all")}
              >
                {scanning === "all" ? "Starting…" : "Scan all libraries"}
              </button>
              {!libraries && <p className="hint">Loading libraries…</p>}
              <ul className="arr-list">
                {(libraries ?? []).map((lib) => (
                  <li key={lib.key} className="arr-item">
                    <div>
                      <strong>{lib.title}</strong>
                      <span className="meta"> {lib.type}</span>
                    </div>
                    <button
                      type="button"
                      className="btn chip"
                      disabled={scanning != null}
                      onClick={() => void scan(lib)}
                    >
                      {scanning === lib.key ? "Starting…" : "Scan"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
