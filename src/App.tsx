import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrPanel } from "./ArrPanel";
import {
  IconDashboard,
  IconEye,
  IconEyeOff,
  IconPower,
  IconSettings,
  ServiceIcon,
} from "./icons";
import {
  loadServices,
  probeService,
  saveServices,
  type ProbeResult,
} from "./probe";
import type { ServiceConfig } from "./services";
import { TautulliPanel } from "./TautulliPanel";
import { WebPanel } from "./WebPanel";
import {
  DEFAULT_WOL,
  detectHomeNetwork,
  loadWolSettings,
  normalizeMac,
  resolveHomeCidr,
  saveWolSettings,
  wakePc,
  type HomeNetworkStatus,
  type WolSettings,
} from "./wol";

type Screen = "modules" | "settings" | "arr" | "tautulli" | "web" | "dashboard";

/** *arr apps with a native ArrPanel (not Prowlarr — web UI only for now). */
const NATIVE_ARR_IDS = new Set([
  "sonarr",
  "radarr",
  "lidarr",
  "readarr",
  "whisparr",
]);

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
  calibre: "Ebook Library",
  overseerr: "Media Requests",
  whisparr: "Manage Adult Movies",
};

function SecretField({
  label,
  value,
  onChange,
  onBlur,
  fieldKey,
  revealed,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  fieldKey: string;
  revealed: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret-input">
        <input
          type={revealed ? "text" : "password"}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          className="secret-toggle"
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          onClick={() => onToggle(fieldKey)}
        >
          {revealed ? (
            <IconEyeOff size={18} color="currentColor" />
          ) : (
            <IconEye size={18} color="currentColor" />
          )}
        </button>
      </div>
    </label>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("modules");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [active, setActive] = useState<ServiceConfig | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>(
    {},
  );
  const [wol, setWol] = useState<WolSettings>(DEFAULT_WOL);
  const [homeNet, setHomeNet] = useState<HomeNetworkStatus | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [svc, wolSettings] = await Promise.all([
        loadServices(),
        loadWolSettings(),
      ]);
      setServices(svc);
      setWol(wolSettings);
      setReady(true);
    })();
  }, []);

  const refreshHomeNet = useCallback(async (settings: WolSettings) => {
    if (!settings.enabled) {
      setHomeNet(null);
      return;
    }
    setHomeNet(await detectHomeNetwork(settings));
  }, []);

  useEffect(() => {
    if (!ready || !wol.enabled) {
      setHomeNet(null);
      return;
    }
    void refreshHomeNet(wol);
    const timer = setInterval(() => void refreshHomeNet(wol), 30000);
    return () => clearInterval(timer);
    // Re-check when home-matching inputs change; avoid every keystroke on MAC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, wol.enabled, wol.homeCidr, wol.targetHost, refreshHomeNet]);

  const persistWol = async (next: WolSettings) => {
    setWol(next);
    await saveWolSettings(next);
    void refreshHomeNet(next);
  };

  const onWakePc = async () => {
    if (wakeBusy) return;
    if (!normalizeMac(wol.mac)) {
      setWakeMessage("Add a valid MAC in Settings → Wake-on-LAN.");
      return;
    }
    const status = homeNet ?? (await detectHomeNetwork(wol));
    setHomeNet(status);
    if (status.warnRemote) {
      const proceed = window.confirm(
        `${status.message}\n\nSend Wake-on-LAN anyway? Direct magic packets only work on home LAN / VPN. Hub relay needs Arrs Hub reachable and awake.`,
      );
      if (!proceed) return;
    }
    setWakeBusy(true);
    setWakeMessage(null);
    try {
      const result = await wakePc(wol);
      setWakeMessage(result.message);
    } finally {
      setWakeBusy(false);
    }
  };

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

  const toggleSecret = (key: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openModule = (service: ServiceConfig) => {
    setDrawer(false);
    if (service.id === "tautulli") {
      setActive(service);
      setScreen("tautulli");
      return;
    }
    if (NATIVE_ARR_IDS.has(service.id)) {
      setActive(service);
      setScreen("arr");
      return;
    }
    setActive(service);
    setScreen("web");
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

  if (screen === "web" && active) {
    return (
      <WebPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
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
              void saveWolSettings(wol);
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

        <section className="card slim">
          <div className="top-row">
            <strong>Wake-on-LAN</strong>
            <label className="toggle">
              <input
                type="checkbox"
                checked={wol.enabled}
                onChange={(e) => {
                  void persistWol({ ...wol, enabled: e.target.checked });
                }}
              />
              <span>On</span>
            </label>
          </div>
          <p className="hint" style={{ padding: "0.35rem 0 0" }}>
            Sends a UDP magic packet from this phone on the home LAN (or VPN).
            Pure cellular / remote internet cannot wake a PC unless Arrs Hub
            (already awake on the LAN) relays it.
          </p>
          <label className="field">
            <span>Target MAC</span>
            <input
              value={wol.mac}
              placeholder="AA:BB:CC:DD:EE:FF"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setWol((prev) => ({ ...prev, mac: e.target.value }))}
              onBlur={(e) =>
                void persistWol({ ...wol, mac: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>PC host / IP (optional, for directed broadcast)</span>
            <input
              value={wol.targetHost}
              placeholder="192.168.1.10"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setWol((prev) => ({ ...prev, targetHost: e.target.value }))
              }
              onBlur={(e) =>
                void persistWol({ ...wol, targetHost: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Broadcast IP</span>
            <input
              value={wol.broadcastIp}
              placeholder="255.255.255.255"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setWol((prev) => ({ ...prev, broadcastIp: e.target.value }))
              }
              onBlur={(e) =>
                void persistWol({
                  ...wol,
                  broadcastIp: e.target.value || "255.255.255.255",
                })
              }
            />
          </label>
          <label className="field">
            <span>UDP port</span>
            <input
              type="number"
              inputMode="numeric"
              value={wol.port}
              onChange={(e) =>
                setWol((prev) => ({
                  ...prev,
                  port: Number(e.target.value) || 9,
                }))
              }
              onBlur={(e) =>
                void persistWol({
                  ...wol,
                  port: Number(e.target.value) || 9,
                })
              }
            />
          </label>
          <label className="field">
            <span>Home network CIDR</span>
            <input
              value={wol.homeCidr}
              placeholder={resolveHomeCidr(wol)}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setWol((prev) => ({ ...prev, homeCidr: e.target.value }))
              }
              onBlur={(e) =>
                void persistWol({ ...wol, homeCidr: e.target.value })
              }
            />
          </label>
          <p className="hint" style={{ padding: "0.25rem 0 0" }}>
            Detection matches this phone&apos;s local IP to the CIDR (default
            /24 of the service host). Set your real LAN subnet if services use
            a public IP (e.g. 192.168.1.0/24).
          </p>
          <label className="field">
            <span>Arrs Hub URL (optional relay)</span>
            <input
              type="url"
              value={wol.hubUrl}
              placeholder="http://192.168.1.10:3000"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setWol((prev) => ({ ...prev, hubUrl: e.target.value }))
              }
              onBlur={(e) =>
                void persistWol({ ...wol, hubUrl: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Hub PC id (optional)</span>
            <input
              value={wol.hubPcId}
              placeholder="pc-…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setWol((prev) => ({ ...prev, hubPcId: e.target.value }))
              }
              onBlur={(e) =>
                void persistWol({ ...wol, hubPcId: e.target.value })
              }
            />
          </label>
          {homeNet && (
            <p className={`hint ${homeNet.warnRemote ? "wol-warn" : "wol-ok"}`}>
              {homeNet.message}
            </p>
          )}
        </section>

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
              <SecretField
                label="API key"
                value={service.apiKey}
                fieldKey={`${service.id}:apiKey`}
                revealed={!!revealedSecrets[`${service.id}:apiKey`]}
                onToggle={toggleSecret}
                onChange={(apiKey) =>
                  setServices((prev) =>
                    prev.map((s) =>
                      s.id === service.id ? { ...s, apiKey } : s,
                    ),
                  )
                }
                onBlur={() => void saveServices(services)}
              />
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
                <SecretField
                  label="Password"
                  value={service.password}
                  fieldKey={`${service.id}:password`}
                  revealed={!!revealedSecrets[`${service.id}:password`]}
                  onToggle={toggleSecret}
                  onChange={(password) =>
                    setServices((prev) =>
                      prev.map((s) =>
                        s.id === service.id ? { ...s, password } : s,
                      ),
                    )
                  }
                  onBlur={() => void saveServices(services)}
                />
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
        {wol.enabled && (
          <div className="wol-bar">
            <button
              type="button"
              className="btn primary wol-btn"
              disabled={wakeBusy}
              onClick={() => void onWakePc()}
            >
              <IconPower size={18} color="currentColor" />
              {wakeBusy ? "Sending…" : "Wake PC"}
            </button>
            <small className={homeNet?.warnRemote ? "wol-warn" : "wol-ok"}>
              {wakeMessage ||
                homeNet?.message ||
                "UDP magic packet on home LAN / VPN"}
            </small>
          </div>
        )}
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
        {wol.enabled && (
          <li>
            <button
              type="button"
              className="module-row"
              disabled={wakeBusy}
              onClick={() => void onWakePc()}
            >
              <span className="module-text">
                <strong>{wakeBusy ? "Waking…" : "Wake PC"}</strong>
                <small>
                  {wakeMessage ||
                    homeNet?.message ||
                    "Wake-on-LAN · home Wi‑Fi / VPN"}
                </small>
              </span>
              <IconPower color="#f0b429" size={28} />
            </button>
          </li>
        )}
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
