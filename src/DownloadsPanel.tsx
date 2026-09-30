import { useCallback, useEffect, useState } from "react";
import { useAndroidBackHandler } from "./androidBack";
import { useActiveInterval } from "./appActive";
import { formatBytes } from "./arrApi";
import {
  fetchDownloadState,
  formatEta,
  formatSpeed,
  setDownloadsPaused,
  setSabSpeedLimit,
  toggleQbitAltSpeed,
  type DownloadClientState,
} from "./downloadsApi";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";

interface DownloadsPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenWeb: () => void;
}

const SAB_LIMITS = [100, 50, 25];

export function DownloadsPanel({
  service,
  onBack,
  onOpenSettings,
  onOpenWeb,
}: DownloadsPanelProps) {
  const [state, setState] = useState<DownloadClientState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isQbit = service.id === "qbittorrent";

  useAndroidBackHandler(() => {
    onBack();
    return true;
  });

  const load = useCallback(async () => {
    try {
      setState(await fetchDownloadState(service));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  useActiveInterval(() => void load(), 3000);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id={service.id} color={service.color} size={22} />
          {service.name}
        </h1>
        <button type="button" className="icon-btn" onClick={onOpenWeb} aria-label="Open web UI">
          ↗
        </button>
      </header>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}

      {state == null && !error && <p className="hint">Connecting…</p>}

      {state && (
        <>
          <div className="dl-stats">
            <div>
              <span className="meta">Down</span>
              <strong>{formatSpeed(state.downloadBps)}</strong>
            </div>
            {state.uploadBps != null && (
              <div>
                <span className="meta">Up</span>
                <strong>{formatSpeed(state.uploadBps)}</strong>
              </div>
            )}
            <div>
              <span className="meta">Status</span>
              <strong>{state.paused ? "Paused" : "Running"}</strong>
            </div>
          </div>

          <div className="arr-item-actions dl-controls">
            <button
              type="button"
              className={`btn chip${state.paused ? " primary" : ""}`}
              disabled={busy != null}
              onClick={() => void run("pause", () => setDownloadsPaused(service, !state.paused))}
            >
              {busy === "pause" ? "…" : state.paused ? "Resume all" : "Pause all"}
            </button>
            {isQbit ? (
              <button
                type="button"
                className={`btn chip${state.limited ? " primary" : ""}`}
                disabled={busy != null}
                onClick={() => void run("alt", () => toggleQbitAltSpeed(service))}
              >
                {busy === "alt" ? "…" : `🐢 ${state.limitLabel}`}
              </button>
            ) : (
              SAB_LIMITS.map((pct) => {
                const current = state.limited ? state.limitLabel === `Limit ${pct}%` : pct === 100;
                return (
                  <button
                    key={pct}
                    type="button"
                    className={`btn chip${current ? " primary" : ""}`}
                    disabled={busy != null}
                    onClick={() => void run(`limit-${pct}`, () => setSabSpeedLimit(service, pct))}
                  >
                    {pct === 100 ? "No limit" : `${pct}%`}
                  </button>
                );
              })
            )}
          </div>

          <div className="luna-subheader">
            <strong>{isQbit ? "Active torrents" : "Queue"}</strong>
            <span>{state.items.length}</span>
          </div>

          {state.items.length === 0 ? (
            <div className="empty-card">
              <strong>Nothing downloading</strong>
            </div>
          ) : (
            <ul className="arr-list">
              {state.items.map((item) => (
                <li key={item.key} className="arr-item">
                  <strong className="dl-name">{item.name}</strong>
                  <div className="arr-progress" aria-label={`${item.progress}%`}>
                    <span style={{ width: `${Math.min(100, item.progress)}%` }} />
                  </div>
                  <span className="meta">
                    {[
                      `${item.progress.toFixed(item.progress % 1 ? 1 : 0)}%`,
                      item.state,
                      item.speedBps ? formatSpeed(item.speedBps) : "",
                      formatEta(item.etaSeconds),
                      formatBytes(item.sizeBytes),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
