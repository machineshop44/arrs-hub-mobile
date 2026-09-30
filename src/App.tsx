import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { ArrPanel } from "./ArrPanel";
import { useAppActive } from "./appActive";
import { setHubWidgetWol } from "./hubWidget";
import { IconSettings, ServiceIcon } from "./icons";
import { App as CapApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { consumeAndroidBack } from "./androidBack";

type WindowFlagsPlugin = {
  setSecure(options: { secure: boolean }): Promise<void>;
};
const WindowFlags = registerPlugin<WindowFlagsPlugin>("WindowFlags");
import {
  fetchHubHealth,
  fetchHubWatchdogStatus,
  hubStatusForService,
  loadModuleOrder,
  loadServices,
  probeService,
  saveModuleOrder,
  saveServices,
  type HubWatchdogStatus,
  type ProbeResult,
} from "./probe";
import {
  applyCompanionUrlHints,
  fetchCompanionUrlHints,
} from "./companionHints";
import {
  DEFAULT_PATHING,
  loadPathSettings,
  pathHintLabel,
  resolveConnectionMode,
  resolveServiceUrl,
  savePathSettings,
  hostFromUrlOrHost,
  type PathSettings,
} from "./pathing";
import {
  planPhotoDumpSetupApply,
  preferHubRemoteUrl,
  isWanHubUrl,
} from "./photoDumpSetupApply";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  isCompanionOnlyService,
  isStatusOnlyService,
  serviceCategory,
  type ServiceCategory,
  type ServiceConfig,
} from "./services";
import { TautulliPanel } from "./TautulliPanel";
import { WebPanel } from "./WebPanel";
import { BazarrPanel } from "./BazarrPanel";
import { YtarrPanel } from "./YtarrPanel";
import { WorkoutsPanel } from "./WorkoutsPanel";
import { PhotoDumpPanel } from "./PhotoDumpPanel";
import { OmbiPanel } from "./OmbiPanel";
import { ProwlarrPanel } from "./ProwlarrPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DownloadsPanel } from "./DownloadsPanel";
import { isDownloadClient } from "./downloadsApi";
import {
  loadPhotoDumpApiKey,
  savePhotoDumpApiKey,
} from "./photoDumpApi";
import {
  addSharedPhotoDumpListener,
  consumeSharedPhotoDumpMedia,
  type PhotoDumpMediaItem,
} from "./photoDumpMedia";
import {
  HUB_AUTH_HINT,
  loadHubApiToken,
  saveHubApiToken,
} from "./hubAuth";
import type { PhotoDumpSetupPayload } from "./photoDumpSetupQr";
import {
  HomeStatusChips,
  type HomeStatusChipsHandle,
} from "./HomeStatusChips";
import {
  getAppVersionInfo,
  shareInstalledApk,
  type AppVersionInfo,
} from "./apkShare";
import {
  APP_MAJOR,
  APP_NAME,
  APP_TITLE,
  APP_VERSION,
  APP_VERSION_LABEL,
} from "./version";

if (typeof document !== "undefined") document.title = `${APP_TITLE} (${APP_VERSION})`;
import {
  applySettingsBundle,
  buildSettingsBundle,
  parseSettingsBundle,
  redactSettingsBundle,
  serializeSettingsBundle,
  shareSettingsJsonFile,
  summarizeBundle,
} from "./settingsTransfer";
import {
  DEFAULT_WOL,
  applyHubPcsToWolTargets,
  buildHubBaseUrl,
  detectHomeNetwork,
  guessBroadcastAddress,
  loadWolSettings,
  normalizeMac,
  saveWolSettings,
  targetWakeReady,
  wakePcByTarget,
  wolSettingsEqual,
  wolTargetLabel,
  type HomeNetworkStatus,
  type WolSettings,
  type WolTargetKey,
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
  | "photo-dump"
  | "ombi"
  | "prowlarr"
  | "downloads"
  | "web";

/** *arr apps with a native ArrPanel (Prowlarr has its own ProwlarrPanel). */
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
  "ytarr",
  "workouts",
  "photo-dump",
  "fileflows",
  "fileflows-node",
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
  flaresolverr: "Cloudflare proxy · status only",
  sabnzbd: "Manage Usenet Downloads",
  qbittorrent: "Manage Torrent Downloads",
  tautulli: "View Plex Activity",
  plex: "Plex Media Server",
  bazarr: "Manage Subtitles",
  ombi: "Search & request media",
  fileflows: "File Processing",
  "fileflows-node": "Processing node · status via Companion",
  calibre: "Ebook Library",
  whisparr: "Manage Adult Movies",
  ytarr: "YouTube Downloads",
  workouts: "Plex workout days",
  "photo-dump": "Upload photos to Hub PC",
};


const PULL_REFRESH_THRESHOLD = 72;

export function App() {
  const [screen, setScreen] = useState<Screen>("modules");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  /** False until first health wave finishes or boot timeout — avoids a frozen Home. */
  const [healthSettled, setHealthSettled] = useState(false);
  /** True once Home has been shown (probe done or boot timeout). */
  const [initialSettled, setInitialSettled] = useState(false);
  /** First boot probe still running after Home was revealed early. */
  const [bootProbing, setBootProbing] = useState(true);
  /** Announced reconnect (resume / pull) — subtle banner, not full overlay. */
  const [reconnecting, setReconnecting] = useState(false);
  const [checkingLabel, setCheckingLabel] = useState("Checking services…");
  const [drawer, setDrawer] = useState(false);
  const [active, setActive] = useState<ServiceConfig | null>(null);
  const [arrInitialTab, setArrInitialTab] = useState<
    "library" | "search" | "calendar" | "missing" | "queue" | undefined
  >(undefined);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>(
    {},
  );
  const [hubApiToken, setHubApiToken] = useState("");
  const [sharedPhotoDumpItems, setSharedPhotoDumpItems] = useState<
    PhotoDumpMediaItem[]
  >([]);
  const [wol, setWol] = useState<WolSettings>(DEFAULT_WOL);
  const [pathing, setPathing] = useState<PathSettings>(DEFAULT_PATHING);
  const [homeNet, setHomeNet] = useState<HomeNetworkStatus | null>(null);
  const [hubReachable, setHubReachable] = useState<boolean | null>(null);
  const [hubLastError, setHubLastError] = useState<string | null>(null);
  const [hubVersion, setHubVersion] = useState<string | null>(null);
  const [hubWatchdog, setHubWatchdog] = useState<HubWatchdogStatus | null>(
    null,
  );
  const [wakeBusyTarget, setWakeBusyTarget] = useState<WolTargetKey | null>(
    null,
  );
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
  const [pullPx, setPullPx] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const chipsRef = useRef<HomeStatusChipsHandle>(null);
  const probeGen = useRef(0);
  const announceCount = useRef(0);
  const initialSettledRef = useRef(false);
  const bootProbeGen = useRef<number | null>(null);
  const pullStartY = useRef<number | null>(null);
  const pullArmed = useRef(false);
  const pullPxRef = useRef(0);
  const pullRefreshingRef = useRef(false);
  const reorderingPullRef = useRef(false);
  const resumeGateAt = useRef(0);
  const appActive = useAppActive();
  const probeWasActiveRef = useRef(true);

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
  reorderingPullRef.current = reordering;
  settingsNetworkOpenRef.current = settingsNetworkOpen;
  settingsWolOpenRef.current = settingsWolOpen;
  settingsWolAdvancedRef.current = settingsWolAdvanced;
  settingsServiceIdRef.current = settingsServiceId;
  initialSettledRef.current = initialSettled;
  pullRefreshingRef.current = pullRefreshing;

  useEffect(() => {
    void (async () => {
      const [svc, wolSettings, pathSettings, order, version, dumpKey, hubToken] =
        await Promise.all([
          loadServices(),
          loadWolSettings(),
          loadPathSettings(),
          loadModuleOrder(),
          getAppVersionInfo(),
          loadPhotoDumpApiKey(),
          loadHubApiToken(),
        ]);
      const photoKey =
        dumpKey.trim() ||
        svc.find((s) => s.id === "photo-dump")?.apiKey.trim() ||
        "";
      const merged = svc.map((s) =>
        s.id === "photo-dump" ? { ...s, apiKey: photoKey } : s,
      );
      if (photoKey) void savePhotoDumpApiKey(photoKey);
      setServices(merged);
      setWol(wolSettings);
      setPathing(pathSettings);
      setModuleOrder(order);
      setAppVersion(version);
      setHubApiToken(hubToken);
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
    if (!appActive) return;
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
    wol.plex.targetHost,
    wol.downloader.targetHost,
    pathing.homeBaseUrl,
    refreshHomeNet,
    appActive,
  ]);

  // Widget "Wake PC" targets the Plex PC first (usually the one that sleeps).
  useEffect(() => {
    if (!ready) return;
    const target = [wol.plex, wol.downloader].find(
      (t) => wol.enabled && t.enabled && normalizeMac(t.mac),
    );
    const customBroadcast = wol.broadcastIp.trim();
    void setHubWidgetWol({
      mac: target ? normalizeMac(target.mac) ?? "" : "",
      broadcast:
        customBroadcast && customBroadcast !== "255.255.255.255"
          ? customBroadcast
          : (target && guessBroadcastAddress(target.targetHost)) || undefined,
      port: wol.port || undefined,
    });
  }, [ready, wol]);

  const persistWol = async (next: WolSettings) => {
    setWol(next);
    await saveWolSettings(next);
    void refreshHomeNet(next, pathing.homeBaseUrl);
  };

  /** Persist WOL using blurred field + latest state (avoids stale closures). */
  const persistWolFromBlur = (patch: (prev: WolSettings) => WolSettings) => {
    setWol((prev) => {
      const next = patch(prev);
      void saveWolSettings(next);
      void refreshHomeNet(next, pathing.homeBaseUrl);
      return next;
    });
  };

  const persistPathingFromBlur = (
    patch: (prev: PathSettings) => PathSettings,
  ) => {
    setPathing((prev) => {
      const next = patch(prev);
      void savePathSettings(next);
      void refreshHomeNet(wol, next.homeBaseUrl);
      return next;
    });
  };

  /** Apply Hub setup QR: photo-dump key (+ optional Hub API token); LAN→homeBaseUrl, WAN→canonical Hub. */
  const applyPhotoDumpSetup = useCallback(
    async (payload: PhotoDumpSetupPayload) => {
      const key = payload.key.trim();
      const hubToken = payload.token?.trim() || "";

      const existingPd =
        services.find((s) => s.id === "photo-dump")?.url.trim() || "";
      const plan = planPhotoDumpSetupApply({
        scannedUrl: payload.url,
        existingWolHubUrl: wol.hubUrl,
        existingPhotoDumpUrl: existingPd,
      });

      const currentHub = preferHubRemoteUrl(existingPd, wol.hubUrl).trim();
      let proposedHub = currentHub;
      if (plan.wolHubUrl !== undefined && plan.wolHubUrl.trim()) {
        proposedHub = plan.wolHubUrl.trim();
      } else if (plan.photoDumpUrl !== undefined && plan.photoDumpUrl.trim()) {
        proposedHub = plan.photoDumpUrl.trim();
      }
      const curHost = hostFromUrlOrHost(currentHub);
      const newHost = hostFromUrlOrHost(proposedHub);
      if (curHost && newHost && curHost !== newHost) {
        const ok = window.confirm(
          `Update Hub host from ${curHost} to ${newHost}?`,
        );
        if (!ok) return false;
      }

      await savePhotoDumpApiKey(key);
      if (hubToken) {
        setHubApiToken(hubToken);
        await saveHubApiToken(hubToken);
      }

      setServices((prev) => {
        const next = prev.map((s) =>
          s.id === "photo-dump"
            ? {
                ...s,
                apiKey: key,
                ...(plan.photoDumpUrl !== undefined
                  ? { url: plan.photoDumpUrl }
                  : {}),
              }
            : s,
        );
        void saveServices(next);
        return next;
      });

      setActive((prev) =>
        prev?.id === "photo-dump" ? { ...prev, apiKey: key } : prev,
      );

      let nextHomeBase = pathing.homeBaseUrl;
      if (plan.homeBaseUrl !== undefined) {
        nextHomeBase = plan.homeBaseUrl;
        const nextPath: PathSettings = {
          ...pathing,
          homeBaseUrl: plan.homeBaseUrl,
        };
        setPathing(nextPath);
        void savePathSettings(nextPath);
      }

      if (
        plan.wolHubUrl !== undefined ||
        plan.wolHubPort !== undefined
      ) {
        setWol((prev) => {
          const next = {
            ...prev,
            ...(plan.wolHubUrl !== undefined
              ? { hubUrl: plan.wolHubUrl }
              : {}),
            ...(plan.wolHubPort !== undefined
              ? { hubPort: plan.wolHubPort }
              : {}),
          };
          void saveWolSettings(next);
          void refreshHomeNet(next, nextHomeBase);
          return next;
        });
      } else if (plan.homeBaseUrl !== undefined) {
        void refreshHomeNet(wol, nextHomeBase);
      }
      return true;
    },
    [pathing, refreshHomeNet, services, wol],
  );

  const runExportConfig = async (redacted = false) => {
    if (transferBusy) return;
    if (
      !window.confirm(
        redacted
          ? "Export a redacted settings file (API keys, passwords, and Hub token blanked). Continue?"
          : "Export includes API keys, passwords, and Hub API token. Only share with devices you trust.\n\nContinue with full export?",
      )
    ) {
      return;
    }
    setTransferBusy(true);
    setTransferMessage(null);
    try {
      const photoDumpKey =
        services.find((s) => s.id === "photo-dump")?.apiKey.trim() || "";
      await Promise.all([
        saveServices(services),
        saveWolSettings(wol),
        savePathSettings(pathing),
        saveModuleOrder(moduleOrder),
        savePhotoDumpApiKey(photoDumpKey),
        saveHubApiToken(hubApiToken),
      ]);
      let bundle = await buildSettingsBundle({
        services,
        moduleOrder,
        wol,
        pathing,
        photoDumpApiKey: photoDumpKey,
        hubApiToken,
      });
      if (redacted) bundle = redactSettingsBundle(bundle);
      const json = serializeSettingsBundle(bundle);
      await shareSettingsJsonFile(
        json,
        redacted
          ? "ArrsHubStatus-settings-redacted.json"
          : "ArrsHubStatus-settings.json",
      );
      setTransferMessage(
        `Shared ${redacted ? "redacted " : ""}settings file (${summarizeBundle(bundle)}).`,
      );
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
    setHubApiToken(applied.hubApiToken);
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
      if (service.id === "workouts" || service.id === "photo-dump") {
        rawUrl = preferHubRemoteUrl(rawUrl, wol.hubUrl);
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
          pathing.connectionPreference,
        ),
      };
    },
    [
      pathing.homeBaseUrl,
      pathing.connectionPreference,
      homeNet?.onHomeNetwork,
      wol.hubUrl,
      wol.hubPort,
    ],
  );

  const servicesRef = useRef(services);
  const withEffectiveUrlRef = useRef(withEffectiveUrl);
  servicesRef.current = services;
  withEffectiveUrlRef.current = withEffectiveUrl;

  /** Photos / Gallery → Share → "Photo Dump" opens this panel with those items queued. */
  useEffect(() => {
    if (!ready || !Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    const openShared = (items: PhotoDumpMediaItem[]) => {
      if (cancelled || !items.length) return;
      setSharedPhotoDumpItems(items);
      const svc = servicesRef.current.find((s) => s.id === "photo-dump");
      if (!svc) return;
      setDrawer(false);
      setArrInitialTab(undefined);
      setActive(withEffectiveUrlRef.current(svc));
      setScreen("photo-dump");
    };

    void (async () => {
      const pending = await consumeSharedPhotoDumpMedia();
      openShared(pending);
      handle = await addSharedPhotoDumpListener(openShared);
    })();

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [ready]);

  const resolveUrl = useCallback(
    (service: ServiceConfig) => withEffectiveUrl(service).url,
    [withEffectiveUrl],
  );

  /** Keep Photo Dump on the live LAN↔WAN effective URL while the panel is open. */
  useEffect(() => {
    if (screen !== "photo-dump") return;
    const svc = services.find((s) => s.id === "photo-dump");
    if (!svc) return;
    setActive((prev) => {
      if (!prev || prev.id !== "photo-dump") return prev;
      const next = withEffectiveUrl({
        ...svc,
        apiKey: prev.apiKey || svc.apiKey,
      });
      if (next.url === prev.url && next.apiKey === prev.apiKey) return prev;
      return next;
    });
  }, [screen, services, withEffectiveUrl]);

  useEffect(() => {
    if (!hubWatchdog?.settingsPcs?.length) return;
    setWol((prev) => {
      const next = applyHubPcsToWolTargets(prev, hubWatchdog.settingsPcs);
      if (wolSettingsEqual(next, prev)) return prev;
      void saveWolSettings(next);
      return next;
    });
  }, [hubWatchdog?.settingsPcs]);

  const onWakeTarget = async (targetKey: WolTargetKey) => {
    if (wakeBusyTarget) return;
    const target = wol[targetKey];
    if (!targetWakeReady(target) && !wol.hubUrl.trim()) {
      setWakeMessage(
        `Add a MAC for ${wolTargetLabel(targetKey)} in Settings → Wake-on-LAN, or an Arrs Hub URL for relay.`,
      );
      return;
    }
    const status =
      homeNet ?? (await detectHomeNetwork(wol, pathing.homeBaseUrl));
    setHomeNet(status);
    const preferHub =
      status.onHomeNetwork === false && Boolean(wol.hubUrl.trim());
    if (status.warnRemote && !preferHub) {
      const proceed = window.confirm(
        `${status.message}\n\nSend Wake-on-LAN to ${wolTargetLabel(targetKey)} anyway? Direct magic packets only work on home LAN / VPN. Hub relay needs Arrs Hub reachable and awake.`,
      );
      if (!proceed) return;
    }
    setWakeBusyTarget(targetKey);
    setWakeMessage(null);
    try {
      const result = await wakePcByTarget(wol, targetKey, { preferHub });
      setWakeMessage(result.message);
    } finally {
      setWakeBusyTarget(null);
    }
  };

  const wakeReadyForTarget = useCallback(
    (targetKey: WolTargetKey): boolean =>
      Boolean(
        wol.enabled &&
          wol[targetKey].enabled &&
          targetWakeReady(wol[targetKey]) &&
          (homeNet === null ||
            homeNet.onHomeNetwork !== false ||
            wol.hubUrl.trim()),
      ),
    [wol, homeNet],
  );

  const enabled = useMemo(
    () =>
      services.filter((s) => {
        if (!s.enabled) return false;
        if (isCompanionOnlyService(s)) return true;
        if (s.id === "workouts" || s.id === "photo-dump") {
          return Boolean(s.url.trim() || wol.hubUrl.trim());
        }
        return Boolean(s.url.trim());
      }),
    [services, wol.hubUrl],
  );

  const resolveHubBase = useCallback((): string => {
    // Prefer Network → Arrs Hub URL; else any Hub-hosted module URL.
    const hubModuleUrl =
      enabled.find((s) => s.id === "photo-dump")?.url.trim() ||
      enabled.find((s) => s.id === "workouts")?.url.trim() ||
      "";
    const hubRaw = wol.hubUrl.trim()
      ? buildHubBaseUrl(wol.hubUrl, wol.hubPort)
      : hubModuleUrl
        ? buildHubBaseUrl(hubModuleUrl, wol.hubPort)
        : "";
    if (!hubRaw) return "";
    return resolveServiceUrl(
      hubRaw,
      pathing.homeBaseUrl,
      homeNet?.onHomeNetwork ?? null,
      pathing.connectionPreference,
    );
  }, [
    enabled,
    wol.hubUrl,
    wol.hubPort,
    pathing.homeBaseUrl,
    pathing.connectionPreference,
    homeNet?.onHomeNetwork,
  ]);

  const syncCompanionUrlHints = useCallback(async () => {
    const hubBase = resolveHubBase();
    if (!hubBase) return;
    const hints = await fetchCompanionUrlHints(hubBase);
    if (!hints || Object.keys(hints).length === 0) return;
    setServices((prev) => {
      const next = applyCompanionUrlHints(prev, hints);
      if (next === prev) return prev;
      void saveServices(next);
      return next;
    });
  }, [resolveHubBase]);

  const refresh = useCallback(
    async (opts?: { announce?: boolean; boot?: boolean }) => {
      const gen = ++probeGen.current;
      const announce = opts?.announce === true;
      const isBoot = opts?.boot === true;
      if (isBoot) bootProbeGen.current = gen;
      if (announce) {
        announceCount.current += 1;
        setCheckingLabel("Reconnecting…");
        setReconnecting(true);
      }

      const next: Record<string, ProbeResult> = {};

      // Hub primary: one watchdog board fetch when configured. Direct probes
      // fill anything still unknown / missing / hub unreachable. Panels open direct.
      const hubBase = resolveHubBase();
      const [hubWatchdogFetch, hubHealth] = hubBase
        ? await Promise.all([
            fetchHubWatchdogStatus(hubBase),
            fetchHubHealth(hubBase),
          ])
        : [{ status: null }, null];
      const hubStatus = hubWatchdogFetch.status;
      const hubServices = hubStatus?.services ?? null;

      const finishAnnounce = () => {
        if (!announce) return;
        announceCount.current = Math.max(0, announceCount.current - 1);
        if (announceCount.current === 0) setReconnecting(false);
      };

      /** Clear sticky boot banner when this gen finishes or is superseded. */
      const clearBootIfOwned = () => {
        if (
          bootProbeGen.current != null &&
          bootProbeGen.current <= gen
        ) {
          bootProbeGen.current = null;
          setBootProbing(false);
        }
      };

      if (gen !== probeGen.current) {
        clearBootIfOwned();
        finishAnnounce();
        return;
      }

      if (!hubBase) {
        setHubReachable(false);
        setHubLastError("Hub URL not configured");
        setHubVersion(null);
        setHubWatchdog(null);
      } else if (hubServices == null) {
        if (hubWatchdogFetch.authRequired) {
          // Hub is up; watchdog needs token — don't pretend the whole Hub is offline.
          setHubReachable(true);
          setHubLastError(HUB_AUTH_HINT);
          setHubVersion(hubHealth?.version ?? null);
          setHubWatchdog(null);
        } else {
          setHubReachable(false);
          setHubLastError("Watchdog unreachable");
          setHubVersion(hubHealth?.version ?? null);
          setHubWatchdog(null);
        }
      } else {
        setHubReachable(true);
        setHubLastError(null);
        setHubVersion(hubHealth?.version ?? null);
        setHubWatchdog(hubStatus);
      }

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

      if (gen !== probeGen.current) {
        clearBootIfOwned();
        finishAnnounce();
        return;
      }

      setHealth(next);
      setHealthSettled(true);
      setInitialSettled(true);
      clearBootIfOwned();
      finishAnnounce();
    },
    [
      enabled,
      withEffectiveUrl,
      resolveHubBase,
    ],
  );

  useEffect(() => {
    if (!ready || hubReachable !== true || !appActive) return;
    void syncCompanionUrlHints();
    const timer = setInterval(() => void syncCompanionUrlHints(), 60_000);
    return () => clearInterval(timer);
  }, [ready, hubReachable, syncCompanionUrlHints, appActive]);

  const runFullReconnect = useCallback(async () => {
    if (pullRefreshingRef.current) return;
    setPullRefreshing(true);
    setCheckingLabel("Reconnecting…");
    try {
      await Promise.all([
        refresh({ announce: true }),
        refreshHomeNet(wol, pathing.homeBaseUrl),
        syncCompanionUrlHints(),
      ]);
      await chipsRef.current?.refreshAll({ plexRefresh: true });
    } finally {
      setPullRefreshing(false);
      setPullPx(0);
    }
  }, [refresh, refreshHomeNet, syncCompanionUrlHints, wol, pathing.homeBaseUrl]);

  useEffect(() => {
    if (!appActive) {
      probeWasActiveRef.current = false;
      return;
    }
    if (!ready) return;
    // The resume listener already runs an announced probe.
    const resumed = !probeWasActiveRef.current;
    probeWasActiveRef.current = true;
    const isBoot = !initialSettledRef.current;
    if (!resumed) {
      if (isBoot) setBootProbing(true);
      void refresh(isBoot ? { boot: true } : undefined);
    }
    // Home tiles only; skip probing while a module panel is open.
    const timer = setInterval(() => {
      if (screenRef.current === "modules") void refresh();
    }, 20000);
    return () => clearInterval(timer);
  }, [ready, refresh, appActive]);

  // Soft reopen: after true background, re-probe without blocking Home again.
  useEffect(() => {
    if (!ready) return;
    let sawBackground = false;
    let debounceTimer: number | null = null;

    const runResumeProbe = () => {
      setCheckingLabel("Reconnecting…");
      if (!initialSettledRef.current) {
        setHealthSettled(false);
      }
      void refresh({ announce: true });
    };

    const onBecameActive = () => {
      if (!sawBackground) return;
      sawBackground = false;
      const now = Date.now();
      // CapApp + visibilitychange can both fire — single gate.
      if (now - resumeGateAt.current < 800) return;
      resumeGateAt.current = now;
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
      setInitialSettled(true);
    }, 8000);
    return () => window.clearTimeout(settleTimeout);
  }, [ready, healthSettled]);

  const pageScrollTop = () =>
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;

  const onHomeTouchStart = (e: ReactTouchEvent) => {
    if (reorderingPullRef.current || pullRefreshingRef.current) return;
    if (pageScrollTop() > 2) {
      pullArmed.current = false;
      pullStartY.current = null;
      return;
    }
    pullArmed.current = true;
    pullStartY.current = e.touches[0]?.clientY ?? null;
  };

  const onHomeTouchMove = (e: ReactTouchEvent) => {
    if (!pullArmed.current || pullStartY.current == null) return;
    if (reorderingPullRef.current || pullRefreshingRef.current) return;
    if (pageScrollTop() > 2) {
      pullArmed.current = false;
      setPullPx(0);
      return;
    }
    const y = e.touches[0]?.clientY ?? pullStartY.current;
    const delta = Math.max(0, y - pullStartY.current);
    if (delta > 8) clearLongPress();
    // Rubber-band: resist past threshold so it doesn't feel sticky.
    const resisted =
      delta < PULL_REFRESH_THRESHOLD
        ? delta
        : PULL_REFRESH_THRESHOLD +
          (delta - PULL_REFRESH_THRESHOLD) * 0.35;
    const nextPx = Math.min(resisted, PULL_REFRESH_THRESHOLD * 1.55);
    pullPxRef.current = nextPx;
    setPullPx(nextPx);
  };

  const onHomeTouchEnd = () => {
    if (!pullArmed.current) return;
    pullArmed.current = false;
    pullStartY.current = null;
    const shouldRefresh = pullPxRef.current >= PULL_REFRESH_THRESHOLD;
    pullPxRef.current = 0;
    setPullPx(0);
    if (shouldRefresh) void runFullReconnect();
  };

  const onHomeTouchCancel = () => {
    pullArmed.current = false;
    pullStartY.current = null;
    setPullPx(0);
  };

  const showBlockingConnect = !healthSettled && !initialSettled;
  const showReconnectBanner =
    initialSettled &&
    (reconnecting || pullRefreshing || (bootProbing && healthSettled));
  const healthScanning =
    showBlockingConnect || reconnecting || pullRefreshing || bootProbing;

  const persist = async (next: ServiceConfig[]) => {
    setServices(next);
    await saveServices(next);
  };

  const toggleSecret = (key: string) => {
    setRevealedSecrets((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (Capacitor.isNativePlatform()) {
        const anyRevealed = Object.values(next).some(Boolean);
        void WindowFlags.setSecure({ secure: anyRevealed }).catch(() => {});
      }
      return next;
    });
  };

  const openModule = (
    service: ServiceConfig,
    opts?: { initialTab?: "library" | "search" | "calendar" | "missing" | "queue" },
  ) => {
    setDrawer(false);
    setReordering(false);
    const resolved = withEffectiveUrl(service);
    if (isCompanionOnlyService(resolved)) {
      chipsRef.current?.openCompanion();
      return;
    }
    // No useful web UI (FlareSolverr only answers the arrs' proxy calls).
    if (isStatusOnlyService(resolved)) return;
    if (service.id === "tautulli") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("tautulli");
      return;
    }
    if (service.id === "bazarr") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("bazarr");
      return;
    }
    if (service.id === "ytarr") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("ytarr");
      return;
    }
    if (service.id === "workouts") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("workouts");
      return;
    }
    if (service.id === "photo-dump") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("photo-dump");
      return;
    }
    if (service.id === "ombi") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("ombi");
      return;
    }
    if (service.id === "prowlarr") {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("prowlarr");
      return;
    }
    if (isDownloadClient(service.id)) {
      setArrInitialTab(undefined);
      setActive(resolved);
      setScreen("downloads");
      return;
    }
    if (NATIVE_ARR_IDS.has(service.id)) {
      setArrInitialTab(opts?.initialTab);
      setActive(resolved);
      setScreen("arr");
      return;
    }
    setArrInitialTab(undefined);
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
    if (!showBlockingConnect || modules.length === 0) {
      return;
    }
    let i = 0;
    setCheckingLabel(`Checking ${modules[0]!.name}…`);
    const timer = window.setInterval(() => {
      i = (i + 1) % modules.length;
      setCheckingLabel(`Checking ${modules[i]!.name}…`);
    }, 850);
    return () => window.clearInterval(timer);
  }, [showBlockingConnect, modules]);

  /** Wake when enabled and we can direct-WOL or relay through an awake hub. */
  const showWakeControl =
    wakeReadyForTarget("plex") || wakeReadyForTarget("downloader");

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

  const hubBaseForChips = useMemo(() => resolveHubBase(), [resolveHubBase]);

  const connectionMode = resolveConnectionMode(
    "auto",
    homeNet?.onHomeNetwork ?? null,
  );

  const openServiceById = (
    id: string,
    opts?: { initialTab?: "library" | "search" | "calendar" | "missing" | "queue" },
  ) => {
    const service = services.find((s) => s.id === id);
    if (service) openModule(service, opts);
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
        key={`${active.id}-${arrInitialTab ?? "library"}`}
        service={active}
        initialTab={arrInitialTab}
        onBack={() => {
          setActive(null);
          setArrInitialTab(undefined);
          setScreen("modules");
        }}
      />
    );
  }

  if (screen === "tautulli" && active) {
    const plex = services.find((s) => s.id === "plex" && s.enabled);
    return (
      <TautulliPanel
        service={active}
        plexService={plex ? withEffectiveUrl(plex) : undefined}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
      />
    );
  }

  if (screen === "prowlarr" && active) {
    return (
      <ProwlarrPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
        onOpenWeb={() => setScreen("web")}
      />
    );
  }

  if (screen === "downloads" && active) {
    return (
      <DownloadsPanel
        service={active}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
        onOpenWeb={() => setScreen("web")}
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

  if (screen === "photo-dump" && active) {
    return (
      <PhotoDumpPanel
        service={active}
        pathHint={pathHintLabel(connectionMode)}
        onBack={() => {
          setActive(null);
          setScreen("modules");
        }}
        onOpenSettings={() => setScreen("settings")}
        onApiKeyChange={(apiKey) => {
          setServices((prev) => {
            const next = prev.map((s) =>
              s.id === "photo-dump" ? { ...s, apiKey } : s,
            );
            void saveServices(next);
            return next;
          });
          setActive((prev) =>
            prev?.id === "photo-dump" ? { ...prev, apiKey } : prev,
          );
          void savePhotoDumpApiKey(apiKey);
        }}
        onSetupApplied={applyPhotoDumpSetup}
        hubVersion={hubVersion}
        sharedItems={sharedPhotoDumpItems}
        onSharedItemsConsumed={() => setSharedPhotoDumpItems([])}
      />
    );
  }

  if (screen === "ombi" && active) {
    return (
      <OmbiPanel
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
              onClick={() => void runExportConfig(false)}
            >
              {transferBusy ? "Working…" : "Export / share settings"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={transferBusy}
              onClick={() => void runExportConfig(true)}
            >
              Export redacted
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
    return (
      <SettingsPanel
        services={services}
        setServices={setServices}
        persist={persist}
        wol={wol}
        setWol={setWol}
        persistWol={persistWol}
        persistWolFromBlur={persistWolFromBlur}
        pathing={pathing}
        setPathing={setPathing}
        persistPathingFromBlur={persistPathingFromBlur}
        connectionMode={connectionMode}
        homeNet={homeNet}
        hubApiToken={hubApiToken}
        setHubApiToken={setHubApiToken}
        revealedSecrets={revealedSecrets}
        toggleSecret={toggleSecret}
        applyPhotoDumpSetup={applyPhotoDumpSetup}
        settingsNetworkOpen={settingsNetworkOpen}
        setSettingsNetworkOpen={setSettingsNetworkOpen}
        settingsWolOpen={settingsWolOpen}
        setSettingsWolOpen={setSettingsWolOpen}
        settingsWolAdvanced={settingsWolAdvanced}
        setSettingsWolAdvanced={setSettingsWolAdvanced}
        settingsServiceId={settingsServiceId}
        setSettingsServiceId={setSettingsServiceId}
        appVersion={appVersion}
        setScreen={setScreen}
        setShareMessage={setShareMessage}
        setTransferMessage={setTransferMessage}
      />
    );
  }

  const onlineCount = modules.filter((m) => health[m.id]?.up === true).length;
  const offlineCount = modules.filter((m) => health[m.id]?.up === false).length;

  return (
    <div
      className="page luna-page home-page"
      onTouchStart={onHomeTouchStart}
      onTouchMove={onHomeTouchMove}
      onTouchEnd={onHomeTouchEnd}
      onTouchCancel={onHomeTouchCancel}
    >
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
        <h1>
          {APP_NAME}{" "}
          <small className="app-version-tag" title={APP_VERSION_LABEL}>
            {APP_MAJOR} · {APP_VERSION}
          </small>
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setScreen("settings")}
          aria-label="Settings"
        >
          <IconSettings size={22} color="currentColor" />
        </button>
      </header>

      <div
        className={`home-pull-indicator${
          pullPx > 0 || pullRefreshing ? " is-visible" : ""
        }${pullRefreshing || pullPx >= PULL_REFRESH_THRESHOLD ? " is-armed" : ""}`}
        style={{
          height:
            pullRefreshing || pullPx > 0
              ? `${Math.max(pullRefreshing ? 44 : pullPx * 0.85, pullRefreshing ? 44 : 0)}px`
              : undefined,
        }}
        aria-hidden={!(pullPx > 0 || pullRefreshing)}
      >
        <div
          className={`boot-spinner home-pull-spinner${pullRefreshing ? " is-spinning" : ""}`}
        />
        <span>
          {pullRefreshing
            ? "Refreshing…"
            : pullPx >= PULL_REFRESH_THRESHOLD
              ? "Release to refresh"
              : "Pull to refresh"}
        </span>
      </div>

      {showReconnectBanner && (
        <div className="home-reconnect-banner" role="status" aria-live="polite">
          <div className="boot-spinner home-reconnect-spinner" aria-hidden="true" />
          <span>Reconnecting…</span>
        </div>
      )}

      {(healthSettled || showWakeControl) && (
        <div className="home-status">
          <HomeStatusChips
            ref={chipsRef}
            hubBaseUrl={hubBaseForChips}
            hubReachable={hubReachable}
            hubLastError={hubLastError}
            hubVersion={hubVersion}
            hubWatchdog={hubWatchdog}
            onHomeNetwork={homeNet?.onHomeNetwork ?? null}
            services={services}
            resolveUrl={resolveUrl}
            modules={modules.map((m) => ({
              id: m.id,
              name: m.name,
              up: health[m.id]?.up ?? null,
            }))}
            upCount={onlineCount}
            downCount={offlineCount}
            scanning={healthScanning && !showBlockingConnect}
            pathHint={pathHintLabel(connectionMode)}
            onOpenStreams={() => openServiceById("tautulli")}
            onOpenService={openServiceById}
            onReconnect={() => void runFullReconnect()}
            reconnecting={reconnecting || pullRefreshing}
            hubWanUnauthWarning={
              isWanHubUrl(hubBaseForChips) && !hubApiToken.trim()
            }
            wolTargets={{
              plex: wakeReadyForTarget("plex"),
              downloader: wakeReadyForTarget("downloader"),
            }}
            wakeBusyTarget={wakeBusyTarget}
            wakeMessage={wakeMessage}
            wolStatusHint={homeNet?.message ?? null}
            wolWarnRemote={Boolean(homeNet?.warnRemote)}
            onWakeTarget={(target) => void onWakeTarget(target)}
          />
        </div>
      )}

      {showBlockingConnect ? (
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
                          {!isStatusOnlyService(service) && (
                            <span className="service-card-arrow" aria-hidden="true">
                              →
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <p className="settings-version home-footer-version" aria-label="App version">
            {APP_VERSION_LABEL}
          </p>
        </>
      )}
    </div>
  );
}
