import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrPanel } from "./ArrPanel";
import { IconDashboard, IconSettings, ServiceIcon } from "./icons";
import {
  loadServices,
  probeService,
  saveServices,
  type ProbeResult,
} from "./probe";
import type { ServiceConfig } from "./services";
import { TautulliPanel } from "./TautulliPanel";

type Screen = "modules" | "settings" | "arr" | "tautulli" | "dashboard";

function statusDotClass(up: boolean | null | undefined): string {
  if (up === true) return "status-dot status-up";
  if (up === false) return "status-dot status-down";
  return "status-dot status-unknown";
}

const MODULE_COPY: Record<string, string> = {
  sonarr: "Manage Television Series",
  radarr: "Manage Movies",
  lidarr: "Manage Music",
  readarr: "Manage Books",
  prowlarr: "Manage Indexers",
  sabnzbd: "Manage Usenet Downloads",
  qbittorrent: "Manage Torrent Downloads",
  tautulli: "View Plex Activity",
  plex: "Plex Media Server",
  bazarr: "Manage Subtitles",
  ombi: "Media Requests",
  fileflows: "File Processing",
};

export function App() {
  const [screen, setScreen] = useState<Screen>("modules");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [active, setActive] = useState<ServiceConfig | null>(null);

  useEffect(() => {
    void (async () => {
      setServices(await loadServices());
      setReady(true);
    })();
  }, []);

  const enabled = useMemo(
    () => services.filter((s) => s.enabled && s.url.trim()),
    [services],
  );

  const refresh = useCallback(async () => {
    const next: Record<string, ProbeResult> = {};
    await Promise.all(
      enabled.map(async (service) => {
        next[service.id] = await probeService(service);
      }),
    );
    setHealth(next);
  }, [enabled]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => clearInterval(timer);
  }, [ready, refresh]);

  const persist = async (next: ServiceConfig[]) => {
    setServices(next);
    await saveServices(next);
  };

  const openModule = (service: ServiceConfig) => {
    setDrawer(false);
    if (service.id === "tautulli") {
      setActive(service);
      setScreen("tautulli");
      return;
    }
    if (service.probe === "arr" && service.id !== "prowlarr") {
      setActive(service);
      setScreen("arr");
      return;
    }
    setScreen("settings");
  };

  const modules = useMemo(() => {
    const preferred = [
      "sonarr",
      "radarr",
      "lidarr",
      "sabnzbd",
      "tautulli",
      "prowlarr",
      "qbittorrent",
    ];
    const list = [...enabled].sort((a, b) => {
      const ai = preferred.indexOf(a.id);
      const bi = preferred.indexOf(b.id);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return list;
  }, [enabled]);

  if (!ready) {
    return (
      <div className="page luna-page">
        <p className="hint">Loading…</p>
      </div>
    );
  }

  if (screen === "arr" && active) {
    return (
      <ArrPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
      />
    );
  }

  if (screen === "tautulli" && active) {
    return (
      <TautulliPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
      />
    );
  }

  if (screen === "settings") {
    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setScreen("modules")}
          >
            ←
          </button>
          <h1>Settings</h1>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              void saveServices(services);
              setScreen("modules");
            }}
          >
            ✓
          </button>
        </header>
        <p className="hint">
          URLs and API keys stay on this device. Tautulli needs its API key
          (Settings → Web Interface in Tautulli).
        </p>
        {services.map((service) => (
          <section key={service.id} className="card slim">
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
                value={service.url}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((s) =>
                      s.id === service.id ? { ...s, url: e.target.value } : s,
                    ),
                  )
                }
                onBlur={() => void saveServices(services)}
              />
            </label>
            {(service.auth === "apiKey" || service.id === "tautulli") && (
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  value={service.apiKey}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((s) =>
                        s.id === service.id
                          ? { ...s, apiKey: e.target.value }
                          : s,
                      ),
                    )
                  }
                  onBlur={() => void saveServices(services)}
                />
              </label>
            )}
            {service.auth === "userPass" && (
              <>
                <label className="field">
                  <span>Username</span>
                  <input
                    value={service.username}
                    onChange={(e) =>
                      setServices((prev) =>
                        prev.map((s) =>
                          s.id === service.id
                            ? { ...s, username: e.target.value }
                            : s,
                        ),
                      )
                    }
                    onBlur={() => void saveServices(services)}
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={service.password}
                    onChange={(e) =>
                      setServices((prev) =>
                        prev.map((s) =>
                          s.id === service.id
                            ? { ...s, password: e.target.value }
                            : s,
                        ),
                      )
                    }
                    onBlur={() => void saveServices(services)}
                  />
                </label>
              </>
            )}
          </section>
        ))}
      </div>
    );
  }

  if (screen === "dashboard") {
    const up = modules.filter((m) => health[m.id]?.up === true).length;
    const down = modules.filter((m) => health[m.id]?.up === false).length;
    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setScreen("modules")}
          >
            ←
          </button>
          <h1>Dashboard</h1>
          <button type="button" className="icon-btn" onClick={() => void refresh()}>
            ↻
          </button>
        </header>
        <div className="dash-summary">
          <div>
            <strong>{up}</strong>
            <span>Online</span>
          </div>
          <div>
            <strong>{down}</strong>
            <span>Down</span>
          </div>
          <div>
            <strong>{modules.length}</strong>
            <span>Modules</span>
          </div>
        </div>
        <ul className="module-list">
          {modules.map((service) => {
            const upState = health[service.id]?.up;
            return (
              <li key={service.id}>
                <button
                  type="button"
                  className="module-row"
                  onClick={() => openModule(service)}
                >
                  <span className={statusDotClass(upState)} aria-hidden="true" />
                  <span className="module-text">
                    <strong>{service.name}</strong>
                    <small>{health[service.id]?.message || "Checking…"}</small>
                  </span>
                  <ServiceIcon id={service.id} color={service.color} size={26} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="page luna-page">
      {drawer && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close menu"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={`drawer ${drawer ? "open" : ""}`}>
        <div className="drawer-head">
          <strong>Arrs</strong>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setDrawer(false);
              setScreen("settings");
            }}
            aria-label="Settings"
          >
            <IconSettings size={22} color="currentColor" />
          </button>
        </div>
        <button
          type="button"
          className="drawer-item"
          onClick={() => {
            setDrawer(false);
            setScreen("dashboard");
          }}
        >
          Dashboard
        </button>
        {modules.map((service) => (
          <button
            key={service.id}
            type="button"
            className="drawer-item"
            onClick={() => openModule(service)}
          >
            <span style={{ display: "inline-flex" }}>
              <ServiceIcon id={service.id} color={service.color} size={18} />
            </span>{" "}
            {service.name}
          </button>
        ))}
        <button
          type="button"
          className="drawer-item"
          onClick={() => {
            setDrawer(false);
            setScreen("settings");
          }}
        >
          Settings
        </button>
      </aside>

      <header className="luna-top">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setDrawer(true)}
          aria-label="Menu"
        >
          ☰
        </button>
        <h1>Arrs</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setScreen("settings")}
          aria-label="Settings"
        >
          <IconSettings size={22} color="currentColor" />
        </button>
      </header>

      <ul className="module-list home">
        <li>
          <button
            type="button"
            className="module-row"
            onClick={() => setScreen("dashboard")}
          >
            <span className="module-text">
              <strong>Dashboard</strong>
              <small>Status of all modules</small>
            </span>
            <IconDashboard color="#5ad1c9" size={28} />
          </button>
        </li>
        {modules.map((service) => {
          const upState = health[service.id]?.up;
          return (
            <li key={service.id}>
              <button
                type="button"
                className="module-row"
                onClick={() => openModule(service)}
              >
                <span className={statusDotClass(upState)} aria-hidden="true" />
                <span className="module-text">
                  <strong>{service.name}</strong>
                  <small>
                    {MODULE_COPY[service.id] || "Open module"}
                    {upState === true
                      ? " · Online"
                      : upState === false
                        ? " · Offline"
                        : ""}
                  </small>
                </span>
                <ServiceIcon id={service.id} color={service.color} size={28} />
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="module-row"
            onClick={() => setScreen("settings")}
          >
            <span className="module-text">
              <strong>Settings</strong>
              <small>Configure Arrs</small>
            </span>
            <IconSettings color="#7ddea0" size={28} />
          </button>
        </li>
      </ul>

      <nav className="luna-bottom">
        <button type="button" className="bottom-pill active">
          Modules
        </button>
        <button
          type="button"
          className="bottom-icon"
          onClick={() => {
            const sonarr = services.find((s) => s.id === "sonarr" && s.enabled);
            if (sonarr) openModule(sonarr);
          }}
          aria-label="Calendar"
        >
          📅
        </button>
      </nav>
    </div>
  );
}
