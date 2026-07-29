import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchHubHealth,
  fetchWatchdogStatus,
  loadHubUrl,
  normalizeHubUrl,
  saveHubUrl,
  type PcHealth,
  type ServiceHealth,
  type WatchPc,
  type WatchTarget,
} from "./hubApi";

type Screen = "status" | "setup";

export function App() {
  const [hubUrl, setHubUrl] = useState(() => loadHubUrl());
  const [draftUrl, setDraftUrl] = useState(() => loadHubUrl());
  const [screen, setScreen] = useState<Screen>(() =>
    loadHubUrl() ? "status" : "setup",
  );
  const [hubUp, setHubUp] = useState<boolean | null>(null);
  const [targets, setTargets] = useState<WatchTarget[]>([]);
  const [services, setServices] = useState<Record<string, ServiceHealth>>({});
  const [pcDefs, setPcDefs] = useState<WatchPc[]>([]);
  const [pcs, setPcs] = useState<Record<string, PcHealth>>({});
  const [watchEnabled, setWatchEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const base = normalizeHubUrl(hubUrl);
    if (!base) {
      setHubUp(false);
      setError("Set your Arrs Hub URL first.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const ok = await fetchHubHealth(base);
      setHubUp(ok);
      if (!ok) {
        setError("Hub did not respond. Check URL, Wi‑Fi, and LAN bind.");
        return;
      }
      const status = await fetchWatchdogStatus(base);
      setTargets(Array.isArray(status.targets) ? status.targets : []);
      setServices(status.services ?? {});
      setPcDefs(Array.isArray(status.settings?.pcs) ? status.settings.pcs : []);
      setPcs(status.pcs ?? {});
      setWatchEnabled(status.settings?.enabled !== false);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setHubUp(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [hubUrl]);

  useEffect(() => {
    if (screen !== "status" || !hubUrl) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [screen, hubUrl, refresh]);

  const rows = useMemo(() => {
    if (targets.length > 0) {
      return targets.map((t) => ({
        id: t.id,
        name: t.name,
        health: services[t.id],
      }));
    }
    return Object.entries(services).map(([id, health]) => ({
      id,
      name: id,
      health,
    }));
  }, [targets, services]);

  const upCount = rows.filter((r) => r.health?.up === true).length;
  const downCount = rows.filter((r) => r.health?.up === false).length;
  const pcOnline = pcDefs.filter((p) => pcs[p.id]?.online === true).length;
  const pcOffline = pcDefs.filter((p) => pcs[p.id]?.online === false).length;

  const onSaveSetup = () => {
    const normalized = normalizeHubUrl(draftUrl);
    if (!normalized) {
      setError("Enter a hub URL like http://192.168.1.50:3847");
      return;
    }
    saveHubUrl(normalized);
    setHubUrl(normalized);
    setDraftUrl(normalized);
    setScreen("status");
    setError(null);
  };

  if (screen === "setup") {
    return (
      <div className="page">
        <header className="top">
          <h1>Arrs Hub</h1>
          <p className="sub">Phone status companion</p>
        </header>
        <section className="card">
          <h2>Hub address</h2>
          <p className="hint">
            On the same Wi‑Fi as your Plex PC. Use the PC&apos;s LAN IP and port
            3847 (or 3000 in desktop mode). Example:{" "}
            <code>http://192.168.1.50:3847</code>
          </p>
          <label className="field">
            <span>Hub base URL</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="http://192.168.1.50:3847"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
            />
          </label>
          {error && <p className="err">{error}</p>}
          <button type="button" className="btn primary" onClick={onSaveSetup}>
            Save &amp; open status
          </button>
        </section>
        <p className="footnote">
          On the PC, start the hub with LAN bind (
          <code>ARRS_HUB_BIND=0.0.0.0</code>) and allow port 3847 in Windows
          Firewall. See the project README.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top">
        <div className="top-row">
          <div>
            <h1>Arrs Hub</h1>
            <p className="sub">Status</p>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraftUrl(hubUrl);
              setScreen("setup");
            }}
          >
            Setup
          </button>
        </div>
        <div className={`pill ${hubUp ? "ok" : hubUp === false ? "bad" : ""}`}>
          {hubUp === null
            ? "Checking hub…"
            : hubUp
              ? "Hub online"
              : "Hub offline"}
        </div>
        <p className="meta">
          {watchEnabled ? "Watch enabled" : "Watch disabled"}
          {lastRefresh ? ` · Updated ${lastRefresh}` : ""}
        </p>
        <p className="summary">
          {rows.length
            ? `${upCount} up · ${downCount} down`
            : "No services reported yet"}
          {pcDefs.length
            ? ` · PCs ${pcOnline} online / ${pcOffline} offline`
            : ""}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {error && <p className="err banner">{error}</p>}

      <section className="list">
        <h2>Apps</h2>
        {rows.length === 0 && (
          <p className="hint">
            No watch targets yet. Keep the desktop Arrs Hub open so it registers
            services, then refresh.
          </p>
        )}
        {rows.map((row) => {
          const up = row.health?.up;
          const statusClass =
            up === true ? "ok" : up === false ? "bad" : "unknown";
          const label =
            up === true ? "Up" : up === false ? "Down" : "Unknown";
          return (
            <article key={row.id} className={`row ${statusClass}`}>
              <div>
                <strong>{row.name}</strong>
                <p>
                  {row.health?.message ||
                    (up === true
                      ? "Responding"
                      : up === false
                        ? "Not responding"
                        : "Waiting for first check")}
                </p>
              </div>
              <div className="right">
                <span className="badge">{label}</span>
                {typeof row.health?.latencyMs === "number" && (
                  <small>{row.health.latencyMs} ms</small>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {pcDefs.length > 0 && (
        <section className="list">
          <h2>PCs</h2>
          {pcDefs.map((pc) => {
            const state = pcs[pc.id];
            const online = state?.online;
            const statusClass =
              online === true ? "ok" : online === false ? "bad" : "unknown";
            const label =
              online === true
                ? "Online"
                : online === false
                  ? "Offline"
                  : "Unknown";
            return (
              <article key={pc.id} className={`row ${statusClass}`}>
                <div>
                  <strong>{pc.name}</strong>
                  <p>
                    {state?.message ||
                      (pc.host ? pc.host : "No host configured")}
                  </p>
                </div>
                <div className="right">
                  <span className="badge">{label}</span>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <p className="footnote url">{hubUrl}</p>
    </div>
  );
}
