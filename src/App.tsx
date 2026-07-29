import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadServices,
  probeService,
  saveServices,
  type ProbeResult,
} from "./probe";
import type { ServiceConfig } from "./services";

type Screen = "status" | "settings" | "viewer";

export function App() {
  const [screen, setScreen] = useState<Screen>("status");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ServiceConfig | null>(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);

  useEffect(() => {
    void (async () => {
      const loaded = await loadServices();
      setServices(loaded);
      setReady(true);
    })();
  }, []);

  const enabled = useMemo(
    () => services.filter((s) => s.enabled && s.url.trim()),
    [services],
  );

  const refresh = useCallback(async () => {
    if (!enabled.length) {
      setHealth({});
      setError("Enable at least one service in Settings.");
      return;
    }
    setRefreshing(true);
    setError(null);
    const next: Record<string, ProbeResult> = {};
    await Promise.all(
      enabled.map(async (service) => {
        next[service.id] = await probeService(service);
      }),
    );
    setHealth(next);
    setLastRefresh(new Date().toLocaleTimeString());
    setRefreshing(false);
  }, [enabled]);

  useEffect(() => {
    if (!ready || screen !== "status") return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [ready, screen, refresh]);

  const upCount = enabled.filter((s) => health[s.id]?.up === true).length;
  const downCount = enabled.filter((s) => health[s.id]?.up === false).length;

  const openService = async (service: ServiceConfig) => {
    const url = service.url.trim();
    if (!url) return;
    setViewer(service);
    setIframeBlocked(false);
    setScreen("viewer");
  };

  const openExternalBrowser = async (url: string) => {
    try {
      await Browser.open({ url });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const persist = async (next: ServiceConfig[]) => {
    setServices(next);
    await saveServices(next);
  };

  if (!ready) {
    return (
      <div className="page">
        <p className="hint">Loading…</p>
      </div>
    );
  }

  if (screen === "settings") {
    return (
      <div className="page">
        <header className="top">
          <div className="top-row">
            <div>
              <h1>Settings</h1>
              <p className="sub">URLs live on this device — no Arrs Hub needed</p>
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setScreen("status")}
            >
              Done
            </button>
          </div>
        </header>

        <p className="hint">
          Prefills use your remote host (<code>67.84.101.14</code>). Edit any URL
          for home Wi‑Fi if you prefer. Optional API keys improve *arr checks.
        </p>

        {services.map((service) => (
          <section key={service.id} className="card service-edit">
            <div className="top-row">
              <strong style={{ color: service.color }}>{service.name}</strong>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={service.enabled}
                  onChange={(e) => {
                    void persist(
                      services.map((s) =>
                        s.id === service.id
                          ? { ...s, enabled: e.target.checked }
                          : s,
                      ),
                    );
                  }}
                />
                <span>On</span>
              </label>
            </div>
            <label className="field">
              <span>URL</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                value={service.url}
                onChange={(e) => {
                  setServices((prev) =>
                    prev.map((s) =>
                      s.id === service.id ? { ...s, url: e.target.value } : s,
                    ),
                  );
                }}
                onBlur={() => void saveServices(services)}
              />
            </label>
            {service.probe === "arr-ping" && (
              <label className="field">
                <span>API key (optional)</span>
                <input
                  type="password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={service.apiKey}
                  placeholder="X-Api-Key"
                  onChange={(e) => {
                    setServices((prev) =>
                      prev.map((s) =>
                        s.id === service.id
                          ? { ...s, apiKey: e.target.value }
                          : s,
                      ),
                    );
                  }}
                  onBlur={() => void saveServices(services)}
                />
              </label>
            )}
          </section>
        ))}

        <button
          type="button"
          className="btn primary"
          onClick={() => {
            void saveServices(services);
            setScreen("status");
          }}
        >
          Save &amp; back to status
        </button>
      </div>
    );
  }

  if (screen === "viewer" && viewer) {
    return (
      <div className="viewer-page">
        <header className="viewer-bar">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setScreen("status");
              setViewer(null);
            }}
          >
            ← Status
          </button>
          <strong>{viewer.name}</strong>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void openExternalBrowser(viewer.url)}
          >
            Browser
          </button>
        </header>
        {iframeBlocked && (
          <div className="err banner">
            This app blocks embedding. Use Browser (in-app tab) to edit.
            <button
              type="button"
              className="btn primary"
              onClick={() => void openExternalBrowser(viewer.url)}
            >
              Open {viewer.name}
            </button>
          </div>
        )}
        <iframe
          title={viewer.name}
          className="viewer-frame"
          src={viewer.url}
          onError={() => setIframeBlocked(true)}
          onLoad={(e) => {
            // Some apps refuse framing; blank/opaque detection is limited.
            try {
              const doc = (e.target as HTMLIFrameElement).contentDocument;
              if (doc === null && Capacitor.isNativePlatform()) {
                // cross-origin — usually fine (loaded)
              }
            } catch {
              // ignore
            }
          }}
          sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin allow-downloads"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top">
        <div className="top-row">
          <div>
            <h1>Arrs Status</h1>
            <p className="sub">Standalone · tap to open &amp; edit</p>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setScreen("settings")}
          >
            Settings
          </button>
        </div>
        <p className="summary">
          {enabled.length
            ? `${upCount} up · ${downCount} down · ${enabled.length} watched`
            : "No services enabled"}
          {lastRefresh ? ` · ${lastRefresh}` : ""}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Checking…" : "Refresh now"}
        </button>
      </header>

      {error && <p className="err banner">{error}</p>}

      <section className="list">
        {enabled.map((service) => {
          const result = health[service.id];
          const up = result?.up;
          const statusClass =
            up === true ? "ok" : up === false ? "bad" : "unknown";
          const label =
            up === true ? "Up" : up === false ? "Down" : "Checking";
          return (
            <button
              type="button"
              key={service.id}
              className={`row clickable ${statusClass}`}
              onClick={() => void openService(service)}
            >
              <div>
                <strong style={{ color: service.color }}>{service.name}</strong>
                <p>{result?.message || "Waiting…"}</p>
              </div>
              <div className="right">
                <span className="badge">{label}</span>
                {typeof result?.latencyMs === "number" && (
                  <small>{result.latencyMs} ms</small>
                )}
                <small className="open-hint">Open</small>
              </div>
            </button>
          );
        })}
      </section>

      <p className="footnote">
        Status checks go straight to each app (LunaSea-style). Opening uses an
        in-app page; if a site blocks embedding, use Browser from the top bar.
        Native edit screens can replace WebViews later, one app at a time.
      </p>
    </div>
  );
}
