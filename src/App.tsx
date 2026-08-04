import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { consumeAndroidBack } from "./androidBack";
import {
  fetchHubWatchdogServices,
  hubStatusForService,
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
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  serviceCategory,
  type ServiceCategory,
  type ServiceConfig,
} from "./services";
import { TautulliPanel } from "./TautulliPanel";
import { WebPanel } from "./WebPanel";
import { BazarrPanel } from "./BazarrPanel";
import { YtarrPanel } from "./YtarrPanel";
import { WorkoutsPanel } from "./WorkoutsPanel";
import { HomeStatusChips } from "./HomeStatusChips";
import {
  getAppVersionInfo,
  shareInstalledApk,
  type AppVersionInfo,
} from "./apkShare";
import { APP_NAME, APP_VERSION_LABEL } from "./version";
import {
  applySettingsBundle,
  buildSettingsBundle,
  parseSettingsBundle,
  serializeSettingsBundle,
  shareSettingsJsonFile,
  summarizeBundle,
} from "./settingsTransfer";
import {
  DEFAULT_HUB_PORT,
  DEFAULT_WOL,
  buildHubBaseUrl,
  detectHomeNetwork,
  formatMacInput,
  loadWolSettings,
  normalizeHubPort,
  normalizeMac,
  resolveHomeCidr,
  saveWolSettings,
  splitHubHostAndPort,
  wakePc,
  type HomeNetworkStatus,
  type WolSettings,
} from "./wol";

type Screen =
  | "modules"
  | "settings"
  | "backup"
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
  "flaresolverr",
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
  flaresolverr: "Cloudflare proxy · needs :8191",
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

function hostSummary(url: string): string {
  const raw = url.trim();
  if (!raw) return "Not set";
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0] || raw;
  }
}

function serviceRowSummary(
  service: ServiceConfig,
  wolHubUrl: string,
  wolHubPort: number,
): string {
  const status = service.enabled ? "On" : "Off";
  let url =
    service.id === "workouts" && !service.url.trim()
      ? wolHubUrl
      : service.url;
  if (service.id === "workouts" && url.trim()) {
    url = buildHubBaseUrl(url, wolHubPort);
  }
  return `${status} · ${hostSummary(url)}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("modules");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  /** False until first health wave finishes or boot timeout — avoids a frozen Home. */
  const [healthSettled, setHealthSettled] = useState(false);
  const [checkingLabel, setCheckingLabel] = useState("Checking services…");
  const [drawer, setDrawer] = useState(false);
  const [active, setActive] = useState<ServiceConfig | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>(
    {},
  );
  const [wol, setWol] = useState<WolSettings>(DEFAULT_WOL);
  const [pathing, setPathing] = useState<PathSettings>(DEFAULT_PATHING);
  const [homeNet, setHomeNet] = useState<HomeNetworkStatus | null>(null);
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);
  const [moduleOrder, setModuleOrder] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [appVersion, setAppVersion] = useState<AppVersionInfo | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [settingsNetworkOpen, setSettingsNetworkOpen] = useState(false);
  const [settingsWolOpen, setSettingsWolOpen] = useState(false);
  const [settingsWolAdvanced, setSettingsWolAdvanced] = useState(false);
  const [settingsServiceId, setSettingsServiceId] = useState<string | null>(
    null,
  );
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  // Keep latest nav state for the Capacitor backButton listener.
  const screenRef = useRef(screen);
  const drawerRef = useRef(drawer);
  const reorderingRef = useRef(reordering);
  const settingsNetworkOpenRef = useRef(settingsNetworkOpen);
  const settingsWolOpenRef = useRef(settingsWolOpen);
  const settingsWolAdvancedRef = useRef(settingsWolAdvanced);
  const settingsServiceIdRef = useRef(settingsServiceId);
  screenRef.current = screen;
  drawerRef.current = drawer;
  reorderingRef.current = reordering;
  settingsNetworkOpenRef.current = settingsNetworkOpen;
  settingsWolOpenRef.current = settingsWolOpen;
  settingsWolAdvancedRef.current = settingsWolAdvanced;
  settingsServiceIdRef.current = settingsServiceId;

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

  // Android gesture / nav-bar back: close overlays → pop panel stack → home → minimize.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handle = CapApp.addListener("backButton", () => {
      if (consumeAndroidBack()) return;

      if (drawerRef.current) {
        setDrawer(false);
        return;
      }

      if (reorderingRef.current) {
        setReordering(false);
        return;
      }

      const current = screenRef.current;

      if (current === "backup") {
        setTransferMessage(null);
        setShareMessage(null);
        setScreen("settings");
        return;
      }

      if (current === "settings") {
        if (settingsServiceIdRef.current) {
          setSettingsServiceId(null);
          return;
        }
        if (settingsWolAdvancedRef.current) {
          setSettingsWolAdvanced(false);
          return;
        }
        if (settingsWolOpenRef.current) {
          setSettingsWolOpen(false);
          return;
        }
        if (settingsNetworkOpenRef.current) {
          setSettingsNetworkOpen(false);
          return;
        }
        setScreen("modules");
        return;
      }

      if (current !== "modules") {
        setActive(null);
        setScreen("modules");
        return;
      }

      void CapApp.minimizeApp();
    });

    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

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

  const runExportConfig = async () => {
    if (transferBusy) return;
    setTransferBusy(true);
    setTransferMessage(null);
    try {
      // Persist current form values before packaging (full snapshot).
      await Promise.all([
        saveServices(services),
        saveWolSettings(wol),
        savePathSettings(pathing),
        saveModuleOrder(moduleOrder),
      ]);
      const bundle = await buildSettingsBundle({
        services,
        moduleOrder,
        wol,
        pathing,
      });
      const json = serializeSettingsBundle(bundle);
      await shareSettingsJsonFile(json);
      setTransferMessage(`Shared settings file (${summarizeBundle(bundle)}).`);
    } catch (err) {
      setTransferMessage(
        err instanceof Error ? err.message : "Could not export settings.",
      );
    } finally {
      setTransferBusy(false);
    }
  };

  const importFromRaw = async (raw: string) => {
    const bundle = parseSettingsBundle(raw);
    const applied = await applySettingsBundle(bundle, services);
    setServices(applied.services);
    setModuleOrder(applied.moduleOrder);
    setWol(applied.wol);
    setPathing(applied.pathing);
    void refreshHomeNet(applied.wol, applied.pathing.homeBaseUrl);
    setTransferMessage(`Imported (${summarizeBundle(bundle)}).`);
  };

  const runImportFile = async (file: File | null | undefined) => {
    if (!file || transferBusy) return;
    setTransferBusy(true);
    setTransferMessage(null);
    try {
      const raw = await file.text();
      await importFromRaw(raw);
    } catch (err) {
      setTransferMessage(
        err instanceof Error ? err.message : "Could not import settings file.",
      );
    } finally {
      setTransferBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const withEffectiveUrl = useCallback(
    (service: ServiceConfig): ServiceConfig => {
      let rawUrl = service.url;
      if (service.id === "workouts") {
        if (!rawUrl.trim() && wol.hubUrl.trim()) {
          rawUrl = wol.hubUrl.trim();
        }
        if (rawUrl.trim()) {
          rawUrl = buildHubBaseUrl(rawUrl, wol.hubPort);
        }
      }
      return {
        ...service,
        url: resolveServiceUrl(
          rawUrl,
          pathing.homeBaseUrl,
          homeNet?.onHomeNetwork ?? null,
        ),
      };
    },
    [pathing.homeBaseUrl, homeNet?.onHomeNetwork, wol.hubUrl, wol.hubPort],
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

    // Hub primary: one watchdog board fetch when configured. Direct probes
    // fill anything still unknown / missing / hub unreachable. Panels open direct.
    const workoutsUrl =
      enabled.find((s) => s.id === "workouts")?.url.trim() || "";
    const hubRaw = wol.hubUrl.trim()
      ? buildHubBaseUrl(wol.hubUrl, wol.hubPort)
      : workoutsUrl
        ? buildHubBaseUrl(workoutsUrl, wol.hubPort)
        : "";
    const hubBase = hubRaw
      ? resolveServiceUrl(
          hubRaw,
          pathing.homeBaseUrl,
          homeNet?.onHomeNetwork ?? null,
        )
      : "";
    const hubServices = hubBase
      ? await fetchHubWatchdogServices(hubBase)
      : null;
    setHubReachable(hubBase ? hubServices != null : false);

    if (hubServices) {
      for (const service of enabled) {
        const hub = hubStatusForService(hubServices, service.id);
        if (!hub || hub.up === null) continue;
        next[service.id] = {
          up: hub.up,
          latencyMs: hub.latencyMs,
          message: hub.up ? "Online (via Hub)" : "Offline (via Hub)",
          viaHub: true,
        };
      }
    }

    const needDirect = enabled.filter(
      (s) => !next[s.id] || next[s.id]!.up === null,
    );
    await Promise.all(
      needDirect.map(async (service) => {
        next[service.id] = await probeService(withEffectiveUrl(service));
      }),
    );

    setHealth(next);
    setHealthSettled(true);
  }, [
    enabled,
    withEffectiveUrl,
    wol.hubUrl,
    wol.hubPort,
    pathing.homeBaseUrl,
    homeNet?.onHomeNetwork,
  ]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => clearInterval(timer);
  }, [ready, refresh]);

  // Soft reopen: after true background, show connecting panel and re-probe once.
  useEffect(() => {
    if (!ready) return;
    let sawBackground = false;
    let debounceTimer: number | null = null;

    const runResumeProbe = () => {
      setCheckingLabel("Reconnecting…");
      setHealthSettled(false);
      void refresh();
    };

    const onBecameActive = () => {
      if (!sawBackground) return;
      sawBackground = false;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runResumeProbe, 350);
    };

    let removeCap: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          sawBackground = true;
          return;
        }
        onBecameActive();
      });
      removeCap = () => {
        void handle.then((h) => h.remove());
      };
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sawBackground = true;
        return;
      }
      if (document.visibilityState === "visible") onBecameActive();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      removeCap?.();
      document.removeEventListener("visibilitychange", onVisibility);
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
    };
  }, [ready, refresh]);

  // Don't leave Home stuck on connecting if probes hang past per-request timeouts.
  useEffect(() => {
    if (!ready || healthSettled) return;
    const settleTimeout = window.setTimeout(() => {
      setHealthSettled(true);
    }, 8000);
    return () => window.clearTimeout(settleTimeout);
  }, [ready, healthSettled]);

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

  useEffect(() => {
    if (healthSettled || modules.length === 0) {
      setCheckingLabel("Checking services…");
      return;
    }
    let i = 0;
    setCheckingLabel(`Checking ${modules[0]!.name}…`);
    const timer = window.setInterval(() => {
      i = (i + 1) % modules.length;
      setCheckingLabel(`Checking ${modules[i]!.name}…`);
    }, 850);
    return () => window.clearInterval(timer);
  }, [healthSettled, modules]);

  /** Wake on Home only when on home LAN, or uncertain (with confirm). Hide off-home. */
  const showWakeControl =
    wol.enabled && homeNet != null && homeNet.onHomeNetwork !== false;

  const persistModuleOrder = async (ids: string[]) => {
    setModuleOrder(ids);
    await saveModuleOrder(ids);
  };

  const moveModule = async (id: string, dir: -1 | 1) => {
    const category = serviceCategory(id);
    const catIds = modules
      .filter((m) => serviceCategory(m.id) === category)
      .map((m) => m.id);
    const i = catIds.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= catIds.length) return;
    const swappedCat = [...catIds];
    const tmp = swappedCat[i]!;
    swappedCat[i] = swappedCat[j]!;
    swappedCat[j] = tmp;

    const next: string[] = [];
    let catEmitted = false;
    for (const mid of modules.map((m) => m.id)) {
      if (serviceCategory(mid) === category) {
        if (!catEmitted) {
          next.push(...swappedCat);
          catEmitted = true;
        }
        continue;
      }
      next.push(mid);
    }
    const rest = moduleOrder.filter((x) => !next.includes(x));
    await persistModuleOrder([...next, ...rest]);
  };

  const modulesByCategory = useMemo(() => {
    const groups: { category: ServiceCategory; items: ServiceConfig[] }[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = modules.filter((m) => serviceCategory(m.id) === category);
      if (items.length > 0) groups.push({ category, items });
    }
    return groups;
  }, [modules]);

  const hubBaseForChips = useMemo(() => {
    const workoutsUrl =
      enabled.find((s) => s.id === "workouts")?.url.trim() || "";
    const hubRaw = wol.hubUrl.trim()
      ? buildHubBaseUrl(wol.hubUrl, wol.hubPort)
      : workoutsUrl
        ? buildHubBaseUrl(workoutsUrl, wol.hubPort)
        : "";
    if (!hubRaw) return "";
    return resolveServiceUrl(
      hubRaw,
      pathing.homeBaseUrl,
      homeNet?.onHomeNetwork ?? null,
    );
  }, [
    enabled,
    wol.hubUrl,
    wol.hubPort,
    pathing.homeBaseUrl,
    homeNet?.onHomeNetwork,
  ]);

  const openServiceById = (id: string) => {
    const service = services.find((s) => s.id === id);
    if (service) openModule(service);
  };

  const cardHealthLabel = (probe: ProbeResult | undefined): string => {
    if (!probe || probe.up === null) return "Unknown";
    if (probe.up) {
      if (probe.viaHub) return "Up · via Hub";
      if (probe.latencyMs != null) return `Up · ${probe.latencyMs}ms`;
      return "Up";
    }
    return probe.viaHub ? "Down · via Hub" : probe.message || "Down";
  };

  if (!ready) {
    return (
      <div className="page luna-page boot-loading" role="status" aria-live="polite">
        <div className="boot-spinner" aria-hidden="true" />
        <strong>Loading…</strong>
        <p className="hint">Loading preferences…</p>
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
        onHomeNetwork={homeNet?.onHomeNetwork ?? null}
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

  if (screen === "backup") {
    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setTransferMessage(null);
              setShareMessage(null);
              setScreen("settings");
            }}
          >
            ←
          </button>
          <h1>Backup &amp; transfer</h1>
          <div className="icon-btn" aria-hidden="true" />
        </header>
        <p className="hint">
          Move this install to another device: send the APK, or export/import
          the full settings snapshot (services, keys, WOL, LAN pathing, module
          order).
        </p>

        <section className="card slim">
          <div className="top-row">
            <strong>Send APK</strong>
          </div>
          <p className="hint" style={{ padding: "0.35rem 0 0.55rem" }}>
            Share the installed APK over Nearby Share, Bluetooth, Files, or
            email. On the other device, open the file and tap Install.
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
                  await shareInstalledApk();
                  setShareMessage("Share sheet opened.");
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
          <div className="top-row">
            <strong>Settings file</strong>
          </div>
          <p className="hint" style={{ padding: "0.35rem 0 0.55rem" }}>
            Export writes a JSON file with every persisted preference. Import
            restores it and refreshes Settings immediately.
          </p>
          <div className="transfer-actions">
            <button
              type="button"
              className="btn primary"
              disabled={transferBusy}
              onClick={() => void runExportConfig()}
            >
              {transferBusy ? "Working…" : "Export / share settings"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={transferBusy}
              onClick={() => importFileRef.current?.click()}
            >
              Import settings file
            </button>
          </div>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json,text/plain"
            style={{ display: "none" }}
            onChange={(e) => void runImportFile(e.target.files?.[0])}
          />
          {transferMessage && (
            <p className="hint" style={{ padding: "0.45rem 0 0" }}>
              {transferMessage}
            </p>
          )}
        </section>
      </div>
    );
  }

  if (screen === "settings") {
    const networkSummary = (() => {
      const hub = wol.hubUrl.trim()
        ? hostSummary(buildHubBaseUrl(wol.hubUrl, wol.hubPort))
        : "";
      if (pathing.homeBaseUrl.trim()) {
        return hub
          ? `LAN · ${hostSummary(pathing.homeBaseUrl)} · Hub ${hub}`
          : `LAN · ${hostSummary(pathing.homeBaseUrl)}`;
      }
      return hub ? `Hub ${hub}` : "Remote URLs only";
    })();
    const wolMac = normalizeMac(wol.mac);
    const wolSummary = wol.enabled
      ? wolMac
        ? `On · ${wolMac}`
        : "On · MAC needed"
      : "Off";
    const derivedCidr = resolveHomeCidr(
      { ...wol, homeCidr: "" },
      pathing.homeBaseUrl,
    );

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
        <p className="hint settings-hint">
          URLs and keys stay on this device.
        </p>

        <button
          type="button"
          className="settings-nav-row"
          onClick={() => {
            setTransferMessage(null);
            setShareMessage(null);
            setScreen("backup");
          }}
        >
          <span className="settings-nav-copy">
            <strong>Backup &amp; transfer</strong>
            <span className="hint" style={{ padding: 0 }}>
              Send APK · export / import settings
            </span>
          </span>
          <span className="settings-nav-chevron" aria-hidden="true">
            ›
          </span>
        </button>

        <div className="settings-accordion">
          <button
            type="button"
            className="settings-accordion-head"
            aria-expanded={settingsNetworkOpen}
            onClick={() => setSettingsNetworkOpen((open) => !open)}
          >
            <span className="settings-nav-copy">
              <strong>Network</strong>
              <span className="hint" style={{ padding: 0 }}>
                {networkSummary}
              </span>
            </span>
            <span
              className={`settings-nav-chevron${settingsNetworkOpen ? " open" : ""}`}
              aria-hidden="true"
            >
              ›
            </span>
          </button>
          {settingsNetworkOpen && (
            <div className="settings-accordion-body">
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
              <p className="hint" style={{ padding: "0.35rem 0 0" }}>
                On home Wi‑Fi, remote hosts swap to this LAN base (ports stay).
                Leave blank to always use remote URLs.
              </p>
              <label className="field">
                <span>Arrs Hub host</span>
                <input
                  type="url"
                  value={wol.hubUrl}
                  placeholder="http://192.168.1.10"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) =>
                    setWol((prev) => ({ ...prev, hubUrl: e.target.value }))
                  }
                  onBlur={(e) => {
                    const { host, port } = splitHubHostAndPort(e.target.value);
                    void persistWol({
                      ...wol,
                      hubUrl: host,
                      hubPort: port ?? wol.hubPort,
                    });
                  }}
                />
              </label>
              <label className="field">
                <span>Arrs Hub port</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  value={wol.hubPort}
                  placeholder={String(DEFAULT_HUB_PORT)}
                  onChange={(e) =>
                    setWol((prev) => ({
                      ...prev,
                      hubPort: normalizeHubPort(
                        e.target.value || DEFAULT_HUB_PORT,
                      ),
                    }))
                  }
                  onBlur={(e) =>
                    void persistWol({
                      ...wol,
                      hubPort: normalizeHubPort(
                        e.target.value || DEFAULT_HUB_PORT,
                      ),
                    })
                  }
                />
              </label>
              <p className="hint" style={{ padding: "0.35rem 0 0" }}>
                Port Arrs Hub listens on (default {DEFAULT_HUB_PORT}). Change if
                another app uses that port.
                {wol.hubUrl.trim() ? (
                  <>
                    {" "}
                    Effective:{" "}
                    <code>{buildHubBaseUrl(wol.hubUrl, wol.hubPort)}</code>
                  </>
                ) : null}
              </p>
              <p className="hint" style={{ padding: "0.35rem 0 0" }}>
                Hub is optional. Used for Workouts and as the primary status
                source when configured; direct probes are backup if Hub is
                unreachable or a service is missing from the watchdog board.
                Opening Sonarr, Radarr, and other panels still goes direct —
                never through the hub.
              </p>
              {homeNet && pathing.homeBaseUrl.trim() && (
                <p
                  className={`hint ${homeNet.warnRemote ? "wol-warn" : "wol-ok"}`}
                  style={{ padding: "0.35rem 0 0" }}
                >
                  {homeNet.onHomeNetwork === true
                    ? `Using LAN host. ${homeNet.message}`
                    : `Using remote URLs. ${homeNet.message}`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="settings-accordion">
          <button
            type="button"
            className="settings-accordion-head"
            aria-expanded={settingsWolOpen}
            onClick={() => setSettingsWolOpen((open) => !open)}
          >
            <span className="settings-nav-copy">
              <strong>Wake-on-LAN</strong>
              <span className="hint" style={{ padding: 0 }}>
                {wolSummary}
              </span>
            </span>
            <span
              className={`settings-nav-chevron${settingsWolOpen ? " open" : ""}`}
              aria-hidden="true"
            >
              ›
            </span>
          </button>
          {settingsWolOpen && (
            <div className="settings-accordion-body">
              <div className="top-row" style={{ marginTop: "0.65rem" }}>
                <span className="hint" style={{ padding: 0 }}>
                  Magic packet on home LAN / VPN
                </span>
                <label
                  className="toggle"
                  onClick={(e) => e.stopPropagation()}
                >
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
              <label className="field">
                <span>PC host / IP (optional)</span>
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
              <button
                type="button"
                className="settings-advanced-toggle"
                aria-expanded={settingsWolAdvanced}
                onClick={() => setSettingsWolAdvanced((open) => !open)}
              >
                <span>Advanced</span>
                <span
                  className={`settings-nav-chevron${settingsWolAdvanced ? " open" : ""}`}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
              {settingsWolAdvanced && (
                <>
                  <label className="field">
                    <span>Broadcast IP</span>
                    <input
                      value={wol.broadcastIp}
                      placeholder="255.255.255.255"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setWol((prev) => ({
                          ...prev,
                          broadcastIp: e.target.value,
                        }))
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
                      placeholder="192.168.1.0/24"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setWol((prev) => ({
                          ...prev,
                          homeCidr: e.target.value,
                        }))
                      }
                      onBlur={(e) =>
                        void persistWol({ ...wol, homeCidr: e.target.value })
                      }
                    />
                  </label>
                  <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                    Leave blank to derive from Home / LAN
                    {derivedCidr ? (
                      <>
                        {" "}
                        (now <code>{derivedCidr}</code>)
                      </>
                    ) : (
                      <>.</>
                    )}
                  </p>
                  <label className="field">
                    <span>Arrs Hub host (relay)</span>
                    <input
                      type="url"
                      value={wol.hubUrl}
                      placeholder="http://192.168.1.10"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setWol((prev) => ({ ...prev, hubUrl: e.target.value }))
                      }
                      onBlur={(e) => {
                        const { host, port } = splitHubHostAndPort(
                          e.target.value,
                        );
                        void persistWol({
                          ...wol,
                          hubUrl: host,
                          hubPort: port ?? wol.hubPort,
                        });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Arrs Hub port</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={wol.hubPort}
                      placeholder={String(DEFAULT_HUB_PORT)}
                      onChange={(e) =>
                        setWol((prev) => ({
                          ...prev,
                          hubPort: normalizeHubPort(
                            e.target.value || DEFAULT_HUB_PORT,
                          ),
                        }))
                      }
                      onBlur={(e) =>
                        void persistWol({
                          ...wol,
                          hubPort: normalizeHubPort(
                            e.target.value || DEFAULT_HUB_PORT,
                          ),
                        })
                      }
                    />
                  </label>
                  <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                    Same as Network → Arrs Hub. Port Arrs Hub listens on
                    (default {DEFAULT_HUB_PORT}).
                  </p>
                  <label className="field">
                    <span>Hub PC id</span>
                    <input
                      value={wol.hubPcId}
                      placeholder="pc-…"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setWol((prev) => ({
                          ...prev,
                          hubPcId: e.target.value,
                        }))
                      }
                      onBlur={(e) =>
                        void persistWol({ ...wol, hubPcId: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {homeNet && (
                <p
                  className={`hint ${homeNet.warnRemote ? "wol-warn" : "wol-ok"}`}
                  style={{ padding: "0.35rem 0 0" }}
                >
                  {homeNet.message}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="settings-group-label">Services</p>
        <div className="settings-service-list">
          {services.map((service) => {
            const expanded = settingsServiceId === service.id;
            return (
              <div key={service.id} className="settings-service-row">
                <button
                  type="button"
                  className="settings-service-head"
                  aria-expanded={expanded}
                  onClick={() =>
                    setSettingsServiceId((id) =>
                      id === service.id ? null : service.id,
                    )
                  }
                >
                  <span
                    className={`settings-service-dot${service.enabled ? " on" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="settings-nav-copy">
                    <strong style={{ color: service.color }}>
                      {service.name}
                    </strong>
                    <span className="hint" style={{ padding: 0 }}>
                      {serviceRowSummary(service, wol.hubUrl, wol.hubPort)}
                    </span>
                  </span>
                  <span
                    className={`settings-nav-chevron${expanded ? " open" : ""}`}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
                {expanded && (
                  <div className="settings-service-body">
                    <div className="top-row" style={{ marginTop: "0.65rem" }}>
                      <span className="hint" style={{ padding: 0 }}>
                        Show on Home
                      </span>
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
                        {service.id === "workouts"
                          ? "Arrs Hub host"
                          : "Remote URL"}
                      </span>
                      <input
                        type="url"
                        value={service.url}
                        placeholder={
                          service.id === "workouts"
                            ? buildHubBaseUrl(wol.hubUrl, wol.hubPort) ||
                              `http://192.168.1.10:${wol.hubPort || DEFAULT_HUB_PORT}`
                            : undefined
                        }
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((s) =>
                              s.id === service.id
                                ? { ...s, url: e.target.value }
                                : s,
                            ),
                          )
                        }
                        onBlur={(e) => {
                          if (service.id === "workouts") {
                            const { host, port } = splitHubHostAndPort(
                              e.target.value,
                            );
                            const nextServices = services.map((s) =>
                              s.id === service.id
                                ? { ...s, url: host || e.target.value.trim() }
                                : s,
                            );
                            setServices(nextServices);
                            void saveServices(nextServices);
                            if (port != null) {
                              void persistWol({ ...wol, hubPort: port });
                            }
                            return;
                          }
                          void saveServices(services);
                        }}
                      />
                    </label>
                    {service.id === "workouts" ? (
                      <>
                        <label className="field">
                          <span>Arrs Hub port</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={65535}
                            value={wol.hubPort}
                            placeholder={String(DEFAULT_HUB_PORT)}
                            onChange={(e) =>
                              setWol((prev) => ({
                                ...prev,
                                hubPort: normalizeHubPort(
                                  e.target.value || DEFAULT_HUB_PORT,
                                ),
                              }))
                            }
                            onBlur={(e) =>
                              void persistWol({
                                ...wol,
                                hubPort: normalizeHubPort(
                                  e.target.value || DEFAULT_HUB_PORT,
                                ),
                              })
                            }
                          />
                        </label>
                        <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                          Port Arrs Hub listens on (default {DEFAULT_HUB_PORT}).
                          Workouts need the hub online at this host/port (home LAN
                          or forwarded remote / VPN). Empty host falls back to
                          Network → Arrs Hub host.
                          {(() => {
                            const base =
                              service.url.trim() || wol.hubUrl.trim();
                            return base ? (
                              <>
                                {" "}
                                Effective:{" "}
                                <code>
                                  {buildHubBaseUrl(base, wol.hubPort)}
                                </code>
                              </>
                            ) : null;
                          })()}
                        </p>
                      </>
                    ) : service.id === "flaresolverr" ? (
                      <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                        Status prefers Arrs Hub watchdog; direct probe on port
                        8191 is backup if Hub can’t see it. Opening the panel
                        still needs 8191 reachable (forward or LAN).
                      </p>
                    ) : service.id === "tautulli" ? (
                      <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                        Needs API key from Tautulli → Settings → Web Interface.
                      </p>
                    ) : null}
                    {(service.auth === "apiKey" ||
                      service.id === "tautulli") && (
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
                          revealed={
                            !!revealedSecrets[`${service.id}:password`]
                          }
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
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="settings-version" aria-label="App version">
          {appVersion
            ? `${APP_VERSION_LABEL} · build ${appVersion.build}`
            : APP_VERSION_LABEL}
        </p>
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
          <strong>{APP_NAME}</strong>
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
        <h1>{APP_NAME}</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setScreen("settings")}
          aria-label="Settings"
        >
          <IconSettings size={22} color="currentColor" />
        </button>
      </header>

      {(healthSettled || showWakeControl) && (
        <div className="home-status">
          {healthSettled && (
            <HomeStatusChips
              hubBaseUrl={hubBaseForChips}
              hubReachable={hubReachable}
              services={services}
              resolveUrl={(s) => withEffectiveUrl(s).url}
              modules={modules.map((m) => ({
                id: m.id,
                name: m.name,
                up: health[m.id]?.up ?? null,
              }))}
              upCount={onlineCount}
              downCount={offlineCount}
              scanning={!healthSettled}
              networkLabel={
                homeNet?.onHomeNetwork === true ? "LAN" : "Remote"
              }
              onOpenStreams={() => openServiceById("tautulli")}
              onOpenService={openServiceById}
              onOpenNetwork={() => {
                setSettingsNetworkOpen(true);
                setScreen("settings");
              }}
            />
          )}
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
      )}

      {!healthSettled ? (
        <div className="home-connecting" role="status" aria-live="polite">
          <div className="boot-spinner" aria-hidden="true" />
          <strong>Checking services…</strong>
          <p className="hint">{checkingLabel}</p>
          <div className="home-connecting-dots" aria-hidden="true">
            {modules.slice(0, 10).map((service) => (
              <span
                key={service.id}
                className="status-dot status-checking"
                style={{ background: service.color || undefined }}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
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

          <div
            className={`home-sections${reordering ? " is-reordering" : ""}`}
          >
            {modulesByCategory.map(({ category, items }) => (
              <section key={category} className="service-section">
                <h2 className="section-title">{CATEGORY_LABELS[category]}</h2>
                <div className="service-grid">
                  {items.map((service, index) => {
                    const probe = health[service.id];
                    const upState = probe?.up;
                    return (
                      <div
                        key={service.id}
                        className={`service-card-wrap${reordering ? " reordering" : ""}`}
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
                              disabled={index === items.length - 1}
                              onClick={() => void moveModule(service.id, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="service-card"
                          style={
                            {
                              "--accent": service.color,
                            } as CSSProperties
                          }
                          {...moduleRowPressHandlers}
                          onClick={() => onModuleRowClick(service)}
                        >
                          <span className="service-card-icon">
                            <ServiceIcon
                              id={service.id}
                              color={service.color}
                              size={28}
                            />
                          </span>
                          <span className="service-card-body">
                            <strong>
                              <span
                                className={statusDotClass(upState)}
                                aria-hidden="true"
                              />
                              {service.name}
                            </strong>
                            <small>
                              {MODULE_COPY[service.id] || "Open module"}
                            </small>
                            <span
                              className={`service-card-health ${
                                upState === true
                                  ? "status-up"
                                  : upState === false
                                    ? "status-down"
                                    : "status-unknown"
                              }`}
                            >
                              {cardHealthLabel(probe)}
                            </span>
                          </span>
                          <span className="service-card-arrow" aria-hidden="true">
                            →
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
