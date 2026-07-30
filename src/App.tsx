import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrPanel } from "./ArrPanel";
import {
  IconEye,
  IconEyeOff,
  IconPower,
  IconSettings,
  ServiceIcon,
} from "./icons";
import {
  loadModuleOrder,
  loadServices,
  probeService,
  saveModuleOrder,
  saveServices,
  type ProbeResult,
} from "./probe";
import {
  DEFAULT_PATHING,
  loadPathSettings,
  resolveServiceUrl,
  savePathSettings,
  type PathSettings,
} from "./pathing";
import type { ServiceConfig } from "./services";
import { TautulliPanel } from "./TautulliPanel";
import { WebPanel } from "./WebPanel";
import { BazarrPanel } from "./BazarrPanel";
import { YtarrPanel } from "./YtarrPanel";
import { WorkoutsPanel } from "./WorkoutsPanel";
import {
  getAppVersionInfo,
  shareInstalledApk,
  type AppVersionInfo,
} from "./apkShare";
import {
  DEFAULT_WOL,
  detectHomeNetwork,
  formatMacInput,
  loadWolSettings,
  normalizeMac,
  resolveHomeCidr,
  saveWolSettings,
  wakePc,
  type HomeNetworkStatus,
  type WolSettings,
} from "./wol";

type Screen =
  | "modules"
  | "settings"
  | "arr"
  | "bazarr"
  | "ytarr"
  | "tautulli"
  | "workouts"
  | "web";

/** *arr apps with a native ArrPanel (not Prowlarr — web UI only for now). */
const NATIVE_ARR_IDS = new Set([
  "sonarr",
  "radarr",
  "lidarr",
  "readarr",
  "whisparr",
]);

/** Fallback order before the user customizes (arrs → downloaders → media). */
const DEFAULT_MODULE_ORDER = [
  "sonarr",
  "radarr",
  "lidarr",
  "readarr",
  "whisparr",
  "prowlarr",
  "bazarr",
  "qbittorrent",
  "sabnzbd",
  "tautulli",
  "plex",
  "ombi",
  "overseerr",
  "ytarr",
  "workouts",
  "fileflows",
  "calibre",
];

function statusDotClass(up: boolean | null | undefined): string {
  if (up === true) return "status-dot status-up";
  if (up === false) return "status-dot status-down";
  return "status-dot status-unknown";
}

function orderIndex(id: string, moduleOrder: string[]): number {
  const saved = moduleOrder.indexOf(id);
  if (saved !== -1) return saved;
  const fallback = DEFAULT_MODULE_ORDER.indexOf(id);
  return 1000 + (fallback === -1 ? 99 : fallback);
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
  ytarr: "YouTube Downloads",
  workouts: "Plex workout days",
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
  const [pathing, setPathing] = useState<PathSettings>(DEFAULT_PATHING);
  const [homeNet, setHomeNet] = useState<HomeNetworkStatus | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);
  const [moduleOrder, setModuleOrder] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [appVersion, setAppVersion] = useState<AppVersionInfo | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    void (async () => {
      const [svc, wolSettings, pathSettings, order, version] = await Promise.all([
        loadServices(),
        loadWolSettings(),
        loadPathSettings(),
        loadModuleOrder(),
        getAppVersionInfo(),
      ]);
      setServices(svc);
      setWol(wolSettings);
      setPathing(pathSettings);
      setModuleOrder(order);
      setAppVersion(version);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (screen !== "modules") {
      setReordering(false);
    }
  }, [screen]);

  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const toggleReorderFromLongPress = () => {
    suppressClick.current = true;
    setReordering((prev) => {
      const next = !prev;
      if (next) {
        try {
          navigator.vibrate?.(14);
        } catch {
          /* optional haptic */
        }
      }
      return next;
    });
  };

  const startLongPress = () => {
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      toggleReorderFromLongPress();
    }, 450);
  };

  useEffect(() => () => clearLongPress(), []);

  const moduleRowPressHandlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      startLongPress();
    },
    onPointerUp: clearLongPress,
    onPointerLeave: clearLongPress,
    onPointerCancel: clearLongPress,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
    },
  };

  const refreshHomeNet = useCallback(
    async (settings: WolSettings, homeBaseUrl: string) => {
      if (!settings.enabled && !homeBaseUrl.trim()) {
        setHomeNet(null);
        return;
      }
      setHomeNet(await detectHomeNetwork(settings, homeBaseUrl));
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    const needDetect = wol.enabled || !!pathing.homeBaseUrl.trim();
    if (!needDetect) {
      setHomeNet(null);
      return;
    }
    void refreshHomeNet(wol, pathing.homeBaseUrl);
    const timer = setInterval(
      () => void refreshHomeNet(wol, pathing.homeBaseUrl),
      30000,
    );
    return () => clearInterval(timer);
    // Re-check when home-matching inputs change; avoid every keystroke on MAC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    wol.enabled,
    wol.homeCidr,
    wol.targetHost,
    pathing.homeBaseUrl,
    refreshHomeNet,
  ]);

  const persistWol = async (next: WolSettings) => {
    setWol(next);
    await saveWolSettings(next);
    void refreshHomeNet(next, pathing.homeBaseUrl);
  };

  const persistPathing = async (next: PathSettings) => {
    setPathing(next);
    await savePathSettings(next);
    void refreshHomeNet(wol, next.homeBaseUrl);
  };

  const withEffectiveUrl = useCallback(
    (service: ServiceConfig): ServiceConfig => {
      const rawUrl =
        service.id === "workouts" && !service.url.trim() && wol.hubUrl.trim()
          ? wol.hubUrl.trim()
          : service.url;
      return {
        ...service,
        url: resolveServiceUrl(
          rawUrl,
          pathing.homeBaseUrl,
          homeNet?.onHomeNetwork ?? null,
        ),
      };
    },
    [pathing.homeBaseUrl, homeNet?.onHomeNetwork, wol.hubUrl],
  );

  const onWakePc = async () => {
    if (wakeBusy) return;
    if (!normalizeMac(wol.mac)) {
      setWakeMessage("Add a valid MAC in Settings → Wake-on-LAN.");
      return;
    }
    const status =
      homeNet ?? (await detectHomeNetwork(wol, pathing.homeBaseUrl));
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
    () =>
      services.filter((s) => {
        if (!s.enabled) return false;
        if (s.id === "workouts") {
          return Boolean(s.url.trim() || wol.hubUrl.trim());
        }
        return Boolean(s.url.trim());
      }),
    [services, wol.hubUrl],
  );

  const refresh = useCallback(async () => {
    const next: Record<string, ProbeResult> = {};
    await Promise.all(
      enabled.map(async (service) => {
        next[service.id] = await probeService(withEffectiveUrl(service));
      }),
    );
    setHealth(next);
  }, [enabled, withEffectiveUrl]);

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
    setReordering(false);
    const resolved = withEffectiveUrl(service);
    if (service.id === "tautulli") {
      setActive(resolved);
      setScreen("tautulli");
      return;
    }
    if (service.id === "bazarr") {
      setActive(resolved);
      setScreen("bazarr");
      return;
    }
    if (service.id === "ytarr") {
      setActive(resolved);
      setScreen("ytarr");
      return;
    }
    if (service.id === "workouts") {
      setActive(resolved);
      setScreen("workouts");
      return;
    }
    if (NATIVE_ARR_IDS.has(service.id)) {
      setActive(resolved);
      setScreen("arr");
      return;
    }
    setActive(resolved);
    setScreen("web");
  };

  const onModuleRowClick = (service: ServiceConfig) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (reordering) return;
    openModule(service);
  };

  const modules = useMemo(() => {
    return [...enabled].sort(
      (a, b) => orderIndex(a.id, moduleOrder) - orderIndex(b.id, moduleOrder),
    );
  }, [enabled, moduleOrder]);

  /** Wake on Home only when on home LAN, or uncertain (with confirm). Hide off-home. */
  const showWakeControl =
    wol.enabled && homeNet != null && homeNet.onHomeNetwork !== false;

  const persistModuleOrder = async (ids: string[]) => {
    setModuleOrder(ids);
    await saveModuleOrder(ids);
  };

  const moveModule = async (id: string, dir: -1 | 1) => {
    const ids = modules.map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const swapped = [...ids];
    const tmp = swapped[i]!;
    swapped[i] = swapped[j]!;
    swapped[j] = tmp;
    const rest = moduleOrder.filter((x) => !swapped.includes(x));
    await persistModuleOrder([...swapped, ...rest]);
  };

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

  if (screen === "bazarr" && active) {
    return (
      <BazarrPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
      />
    );
  }

  if (screen === "ytarr" && active) {
    return (
      <YtarrPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
      />
    );
  }

  if (screen === "workouts" && active) {
    return (
      <WorkoutsPanel
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
              void savePathSettings(pathing);
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
            <strong>Share APK</strong>
            {appVersion && (
              <span className="hint" style={{ padding: 0 }}>
                v{appVersion.version} ({appVersion.build})
              </span>
            )}
          </div>
          <p className="hint" style={{ padding: "0.35rem 0 0.55rem" }}>
            Send a phone/tablet‑installable build over Quick Share, Bluetooth,
            Files, email, or Drive. Prefer sharing after installing a{" "}
            <strong>universal APK</strong> (Build APK / GitHub release) — not an
            Android Studio “Run” split deploy. On the other device, open the file
            and tap Install (allow unknown apps if asked).
          </p>
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%" }}
            disabled={shareBusy}
            onClick={() => {
              void (async () => {
                setShareBusy(true);
                setShareMessage(null);
                try {
                  const result = await shareInstalledApk();
                  if (result.splitPackage) {
                    setShareMessage(
                      `Shared ${result.fileName} (${result.partCount ?? "?"} parts). ` +
                        "This device has a split install — the other phone needs SAI / " +
                        '"Install with Options", or use the universal APK from the GitHub release.',
                    );
                  } else {
                    setShareMessage(
                      `Share sheet opened with ${result.fileName}.`,
                    );
                  }
                } catch (err) {
                  setShareMessage(
                    err instanceof Error
                      ? err.message
                      : "Could not share APK.",
                  );
                } finally {
                  setShareBusy(false);
                }
              })();
            }}
          >
            {shareBusy ? "Preparing APK…" : "Send APK"}
          </button>
          {shareMessage && (
            <p className="hint" style={{ padding: "0.45rem 0 0" }}>
              {shareMessage}
            </p>
          )}
        </section>

        <section className="card slim">
          <strong>Network pathing</strong>
          <p className="hint" style={{ padding: "0.35rem 0 0.55rem" }}>
            <strong>Remote</strong> URLs (per service below) work home or away
            via port forward. <strong>Home / LAN</strong> is your server&apos;s
            local address — used automatically when this device is on your home
            Wi‑Fi for faster LAN access, and to derive the WOL home subnet so
            Wake-on-LAN detection works.
          </p>
          <label className="field">
            <span>Home / LAN base URL</span>
            <input
              type="url"
              value={pathing.homeBaseUrl}
              placeholder="http://192.168.1.50"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) =>
                setPathing((prev) => ({
                  ...prev,
                  homeBaseUrl: e.target.value,
                }))
              }
              onBlur={(e) =>
                void persistPathing({
                  ...pathing,
                  homeBaseUrl: e.target.value.trim(),
                })
              }
            />
          </label>
          <p className="hint" style={{ padding: "0.25rem 0 0" }}>
            Host only is enough (ports come from each remote URL). Example:{" "}
            <code>http://192.168.1.50</code> → Sonarr becomes{" "}
            <code>http://192.168.1.50:8989</code> while on home Wi‑Fi. Leave
            blank to always use remote URLs.
          </p>
          {homeNet && pathing.homeBaseUrl.trim() && (
            <p
              className={`hint ${homeNet.warnRemote ? "wol-warn" : "wol-ok"}`}
              style={{ padding: "0.35rem 0 0" }}
            >
              {homeNet.onHomeNetwork === true
                ? `Using LAN host for probes/modules. ${homeNet.message}`
                : `Using remote URLs. ${homeNet.message}`}
            </p>
          )}
        </section>

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
            (already awake on the LAN) relays it. The Wake button appears on
            Home only when you&apos;re on the home network.
          </p>
          <label className="field">
            <span>Target MAC</span>
            <input
              value={wol.mac}
              placeholder="AA:BB:CC:DD:EE:FF"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              onChange={(e) => {
                const mac = formatMacInput(e.target.value);
                setWol((prev) => ({ ...prev, mac }));
              }}
              onBlur={(e) => {
                const mac = formatMacInput(e.target.value);
                void persistWol({ ...wol, mac });
              }}
            />
          </label>
          <p className="hint" style={{ padding: "0.15rem 0 0" }}>
            Formats as AA:BB:CC:DD:EE:FF while typing. Paste bare hex or
            dash-separated MACs — they normalize automatically.
          </p>
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
            <span>Home network CIDR (LAN subnet)</span>
            <input
              value={wol.homeCidr}
              placeholder="192.168.1.0/24"
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
            Your home Wi‑Fi subnet as CIDR (e.g. <code>192.168.1.0/24</code>).
            Used to detect “are we on home Wi‑Fi?” for the Wake button and LAN
            pathing. Leave blank to derive from Home / LAN base URL (preferred)
            or a private PC host/IP above — never from the public remote IP.
            {resolveHomeCidr({ ...wol, homeCidr: "" }, pathing.homeBaseUrl) ? (
              <>
                {" "}
                Current fallback:{" "}
                <code>
                  {resolveHomeCidr(
                    { ...wol, homeCidr: "" },
                    pathing.homeBaseUrl,
                  )}
                </code>
                .
              </>
            ) : (
              <> Set a Home / LAN base URL to enable automatic detection.</>
            )}
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
              <span>
                {service.id === "workouts" ? "Arrs Hub URL" : "Remote URL"}
              </span>
              <input
                type="url"
                value={service.url}
                placeholder={
                  service.id === "workouts"
                    ? wol.hubUrl.trim() || "http://192.168.1.10:3000"
                    : undefined
                }
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
            <p className="hint" style={{ padding: "0.15rem 0 0" }}>
              {service.id === "workouts" ? (
                <>
                  Points at Arrs Hub (not Plex). Plex token stays on the hub in
                  workout-settings.json. Falls back to Wake-on-LAN → Arrs Hub URL
                  when empty. Hub must be LAN-bound for the tablet (
                  <code>start-hub-lan.bat</code>).
                </>
              ) : (
                <>
                  Works everywhere via port forward. On home Wi‑Fi, host is swapped
                  to Home / LAN base when that is set.
                </>
              )}
            </p>
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

  const onlineCount = modules.filter((m) => health[m.id]?.up === true).length;
  const offlineCount = modules.filter((m) => health[m.id]?.up === false).length;

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

      <div className="home-status">
        <p className="home-status-line" aria-live="polite">
          <span className="status-dot status-up" aria-hidden="true" />
          {onlineCount} online
          <span className="home-status-sep">·</span>
          <span className="status-dot status-down" aria-hidden="true" />
          {offlineCount} offline
          <span className="home-status-sep">·</span>
          {modules.length} modules
          {pathing.homeBaseUrl.trim() && (
            <>
              <span className="home-status-sep">·</span>
              {homeNet?.onHomeNetwork === true ? "LAN" : "Remote"}
            </>
          )}
        </p>
        {showWakeControl && (
          <div className="wol-bar home-wol">
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
      </div>

      {reordering && (
        <div className="reorder-bar">
          <span>Reorder modules</span>
          <button
            type="button"
            className="btn reorder-done"
            onClick={() => setReordering(false)}
          >
            Done
          </button>
        </div>
      )}

      <ul className={`module-list home${reordering ? " is-reordering" : ""}`}>
        {modules.map((service, index) => {
          const upState = health[service.id]?.up;
          return (
            <li
              key={service.id}
              className={`module-item${reordering ? " reordering" : ""}`}
            >
              {reordering && (
                <div className="reorder-btns">
                  <button
                    type="button"
                    className="reorder-btn"
                    aria-label={`Move ${service.name} up`}
                    disabled={index === 0}
                    onClick={() => void moveModule(service.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="reorder-btn"
                    aria-label={`Move ${service.name} down`}
                    disabled={index === modules.length - 1}
                    onClick={() => void moveModule(service.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              )}
              <button
                type="button"
                className="module-row"
                {...moduleRowPressHandlers}
                onClick={() => onModuleRowClick(service)}
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
            onClick={() => {
              setReordering(false);
              setScreen("settings");
            }}
          >
            <span className="module-text">
              <strong>Settings</strong>
              <small>Configure Arrs</small>
            </span>
            <IconSettings color="#7ddea0" size={28} />
          </button>
        </li>
      </ul>
    </div>
  );
}
