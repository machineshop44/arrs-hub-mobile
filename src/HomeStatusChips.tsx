import { HubAuthError } from "./hubAuth";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { IconPower } from "./icons";
import { useActiveInterval, useAppActive } from "./appActive";
import { formatBytes, formatScheduleWhen } from "./arrApi";
import {
  fetchArrHealthSummary,
  fetchUpcoming,
  isLowDisk,
  type ArrHealthSummary,
  type UpcomingItem,
} from "./homeExtras";
import { fetchTautulliActivity, type TautulliSession } from "./tautulliApi";
import { updateHubWidget } from "./hubWidget";

/** App versions change rarely; the summary still polls every 20 s. */
const CHIP_VERSIONS_INTERVAL_MS = 5 * 60_000;
import {
  fetchHubStatusSummary,
  fetchOmbiPending,
  approveOmbiRequest,
  denyOmbiRequestViaHub,
  issueBadge,
  ombiTypeLabel,
  type ArrQueueApp,
  type HubStatusSummary,
  type OmbiPendingItem,
} from "./hubSummary";
import { denyOmbiRequestDirect } from "./ombiApi";
import {
  fetchChipVersions,
  fetchAppUpdateJob,
  startAppUpdate,
  CLICK_UPDATE_APP_IDS,
  COMPANION_CLICK_UPDATE_IDS,
  type AppUpdateJobState,
  type ChipVersionsPayload,
} from "./chipVersions";
import {
  buildCompanionPcStatus,
  companionAppHealthLabel,
  companionChipMeta,
  mergeCompanionDisplayApps,
} from "./companionStatus";
import { useAndroidBackHandler } from "./androidBack";
import { hubStatusForService } from "./probe";
import {
  fetchPlexUpdateJob,
  fetchPlexUpdateStatus,
  plexJobBusy,
  plexStatusAllowsInstall,
  shortPlexVersion,
  startPlexUpdateJob,
  type PlexUpdateStatus,
} from "./plexUpdateApi";
import { createPlexPollController } from "./plexPollGuard";
import type { HubWatchdogStatus } from "./probe";
import type { ServiceConfig } from "./services";

export type HomeStatusChipsHandle = {
  /** Re-fetch hub summary + plex (refresh=1 when allowed). */
  refreshAll: (opts?: { plexRefresh?: boolean }) => Promise<void>;
  openCompanion: () => void;
};

type ChipTone = "good" | "bad" | "accent" | "warn" | "muted";
type SheetId =
  | "hub"
  | "companion"
  | "up"
  | "down"
  | "queue"
  | "downloads"
  | "ombi"
  | "plex"
  | "wol"
  | "health"
  | null;

const SHEET_CHIPS = [
  "hub",
  "companion",
  "up",
  "down",
  "queue",
  "downloads",
  "ombi",
  "plex",
  "wol",
  "health",
] as const satisfies readonly Exclude<SheetId, null>[];

const NOW_PLAYING_INTERVAL_MS = 20_000;
const HEALTH_INTERVAL_MS = 5 * 60_000;
const UPCOMING_INTERVAL_MS = 15 * 60_000;

const CANNOT_INSTALL_HINT =
  "Plex reports canInstall=false (manual/NAS installs cannot be applied from the hub).";

function checkResultMessage(next: PlexUpdateStatus): string {
  if (next.updateAvailable) {
    return `Update available: ${shortPlexVersion(next.installedVersion)} → ${shortPlexVersion(next.latestVersion)}`;
  }
  if (next.ok && next.installedVersion) return "Up to date";
  if (next.error) return next.error;
  return "Check finished.";
}

function plexInstallBlockedDetail(status: PlexUpdateStatus): string {
  if (status.error?.trim()) return status.error.trim();
  if (
    status.installMethod === "windows-installer" &&
    status.hubLocal !== true
  ) {
    return "Windows installer path needs hub on the PMS PC (plexBaseUrl localhost).";
  }
  if (status.updateAvailable && status.channel === "plex.tv") {
    return "Seen on plex.tv, but Install is unavailable from this hub (need Arrs Hub 1.3.22+ on the Windows PMS PC, or wait for PMS /updater).";
  }
  return CANNOT_INSTALL_HINT;
}

export type HomeChipModule = {
  id: string;
  name: string;
  up: boolean | null;
};

type HomeStatusChipsProps = {
  hubBaseUrl: string;
  hubReachable: boolean | null;
  hubLastError?: string | null;
  hubVersion?: string | null;
  hubWatchdog?: HubWatchdogStatus | null;
  /** Prefer true for install/download; false disables apply with a clear reason. */
  onHomeNetwork: boolean | null;
  services: ServiceConfig[];
  resolveUrl: (service: ServiceConfig) => string;
  modules: HomeChipModule[];
  upCount: number;
  downCount: number;
  scanning: boolean;
  /** Non-clickable LAN / Remote hint from IP/CIDR detection. */
  pathHint: "LAN" | "Remote";
  onOpenStreams: () => void;
  onOpenService: (
    id: string,
    opts?: { initialTab?: "library" | "search" | "calendar" | "missing" | "queue" },
  ) => void;
  /** Full reconnect (same as pull-to-refresh). */
  onReconnect?: () => void;
  reconnecting?: boolean;
  /** True when Hub host is public WAN and Hub API token is empty. */
  hubWanUnauthWarning?: boolean;
  /** Wake-on-LAN targets ready to show under the WOL PCs chip. */
  wolTargets?: {
    plex: boolean;
    downloader: boolean;
  };
  wakeBusyTarget?: "plex" | "downloader" | null;
  wakeMessage?: string | null;
  wolStatusHint?: string | null;
  wolWarnRemote?: boolean;
  onWakeTarget?: (target: "plex" | "downloader") => void;
};

export const HomeStatusChips = forwardRef<
  HomeStatusChipsHandle,
  HomeStatusChipsProps
>(function HomeStatusChips(
  {
    hubBaseUrl,
    hubReachable,
    hubLastError = null,
    hubVersion = null,
    hubWatchdog = null,
    onHomeNetwork,
    services,
    resolveUrl,
    modules,
    upCount,
    downCount,
    scanning,
    pathHint,
    onOpenStreams,
    onOpenService,
    onReconnect,
    reconnecting = false,
    hubWanUnauthWarning = false,
    wolTargets = { plex: false, downloader: false },
    wakeBusyTarget = null,
    wakeMessage = null,
    wolStatusHint = null,
    wolWarnRemote = false,
    onWakeTarget,
  },
  ref,
) {
  const [summary, setSummary] = useState<HubStatusSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [chipVersions, setChipVersions] = useState<ChipVersionsPayload | null>(
    null,
  );
  const [appUpdateJobs, setAppUpdateJobs] = useState<
    Record<string, AppUpdateJobState>
  >({});
  const [appUpdateNotice, setAppUpdateNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [ombiItems, setOmbiItems] = useState<OmbiPendingItem[]>([]);
  const [ombiLoading, setOmbiLoading] = useState(false);
  const [ombiError, setOmbiError] = useState<string | null>(null);
  const [ombiApprovingId, setOmbiApprovingId] = useState<string | null>(null);
  const [plexStatus, setPlexStatus] = useState<PlexUpdateStatus | null>(null);
  const [plexLoading, setPlexLoading] = useState(false);
  const [plexChecking, setPlexChecking] = useState(false);
  const [plexBusy, setPlexBusy] = useState(false);
  const [plexError, setPlexError] = useState<string | null>(null);
  const [plexActionMsg, setPlexActionMsg] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const didStartupRefresh = useRef(false);
  const lastResumeRefreshAt = useRef(0);
  const plexPoll = useRef(createPlexPollController());
  const summaryGen = useRef(0);
  const plexJobPollInFlight = useRef(false);
  const versionsFetchedAt = useRef(0);
  const appActive = useAppActive();
  const [nowPlaying, setNowPlaying] = useState<TautulliSession[] | null>(null);
  const [arrHealth, setArrHealth] = useState<ArrHealthSummary | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[] | null>(null);

  const tautulliService = useMemo(() => {
    const s = services.find((x) => x.id === "tautulli" && x.enabled && x.apiKey.trim());
    return s ? { ...s, url: resolveUrl(s) } : null;
  }, [services, resolveUrl]);

  const loadNowPlaying = useCallback(async () => {
    if (!tautulliService) {
      setNowPlaying(null);
      return;
    }
    const res = await fetchTautulliActivity(tautulliService).catch(() => null);
    if (res?.ok) setNowPlaying(res.sessions);
  }, [tautulliService]);

  const loadArrHealth = useCallback(async () => {
    setArrHealth(await fetchArrHealthSummary(services, resolveUrl).catch(() => null));
  }, [services, resolveUrl]);

  const loadUpcoming = useCallback(async () => {
    setUpcoming(await fetchUpcoming(services, resolveUrl, 7).catch(() => null));
  }, [services, resolveUrl]);

  useActiveInterval(() => void loadNowPlaying(), NOW_PLAYING_INTERVAL_MS, { runOnResume: true });
  useActiveInterval(() => void loadArrHealth(), HEALTH_INTERVAL_MS, { runOnResume: false });
  useActiveInterval(() => void loadUpcoming(), UPCOMING_INTERVAL_MS, { runOnResume: false });

  useEffect(() => {
    void loadNowPlaying();
  }, [loadNowPlaying]);
  useEffect(() => {
    void loadArrHealth();
  }, [loadArrHealth]);
  useEffect(() => {
    void loadUpcoming();
  }, [loadUpcoming]);

  const hubDown = hubReachable === false || !hubBaseUrl.trim();

  useEffect(() => {
    if (hubDown) {
      void updateHubWidget({ streams: null, downloads: null, ombiPending: null });
      return;
    }
    if (!summary) return;
    void updateHubWidget({
      streams: summary.streams?.configured ? summary.streams.streamCount : null,
      downloads: summary.downloads ? summary.downloads.active : null,
      ombiPending: summary.ombi?.configured ? summary.ombi.pending : null,
    });
  }, [summary, hubDown]);
  /** Same gate as chip probes: hub up; skip expensive refresh off home LAN. */
  const allowPlexRefresh = !hubDown && onHomeNetwork !== false;

  const load = useCallback(async (opts: { forceVersions?: boolean } = {}) => {
    if (hubDown) {
      setSummary(null);
      setSummaryError(null);
      setChipVersions(null);
      setPlexStatus(null);
      versionsFetchedAt.current = 0;
      return;
    }
    const gen = ++summaryGen.current;
    const wantVersions =
      opts.forceVersions ||
      Date.now() - versionsFetchedAt.current > CHIP_VERSIONS_INTERVAL_MS;
    if (wantVersions) versionsFetchedAt.current = Date.now();
    try {
      const [next, versions] = await Promise.all([
        fetchHubStatusSummary(hubBaseUrl, services, resolveUrl),
        wantVersions
          ? fetchChipVersions(hubBaseUrl, services, resolveUrl).catch(() => {
              versionsFetchedAt.current = 0;
              return null;
            })
          : Promise.resolve(null),
      ]);
      if (gen !== summaryGen.current) return;
      if (next) {
        setSummary(next);
        setSummaryError(null);
      } else {
        // Keep last good summary so chips don't flash to "—" / setup on a blip.
        setSummaryError(
          (prev) => prev ?? "Could not refresh hub activity summary.",
        );
      }
      if (versions) setChipVersions(versions);
    } catch (err) {
      if (gen !== summaryGen.current) return;
      if (err instanceof HubAuthError) {
        setSummaryError(err.message);
        return;
      }
      setSummaryError(
        err instanceof Error ? err.message : "Could not refresh hub activity.",
      );
    }
  }, [hubBaseUrl, hubDown, services, resolveUrl]);

  const loadPlex = useCallback(
    async (
      refresh = false,
      opts: { announce?: boolean } = {},
    ) => {
      if (hubDown) {
        setPlexStatus(null);
        return;
      }
      const kind = refresh ? "refresh" : "cached";
      const ticket = plexPoll.current.begin(kind);
      if (!ticket) {
        if (refresh && opts.announce && plexPoll.current.refreshInFlight) {
          setPlexActionMsg("Check already in progress…");
        }
        return;
      }

      if (refresh) {
        setPlexChecking(true);
        if (opts.announce) {
          setPlexError(null);
          setPlexActionMsg(null);
        }
      } else {
        setPlexLoading(true);
      }
      try {
        const next = await fetchPlexUpdateStatus(hubBaseUrl, {
          refresh,
          // Real PMS + plex.tv check can take a bit longer than cached polls.
          timeoutMs: refresh ? 45000 : 20000,
        });
        if (!plexPoll.current.isCurrent(ticket)) return;
        setPlexStatus(next);
        setPlexError(next.error || null);
        if (refresh && opts.announce) {
          setPlexActionMsg(checkResultMessage(next));
        }
      } catch (err) {
        if (!plexPoll.current.isCurrent(ticket)) return;
        setPlexError(err instanceof Error ? err.message : String(err));
        if (refresh && opts.announce) setPlexActionMsg(null);
      } finally {
        const { clearChecking } = plexPoll.current.end(ticket);
        if (refresh) {
          if (clearChecking) setPlexChecking(false);
        } else {
          // Always clear; a newer request may still be in flight.
          setPlexLoading(false);
        }
      }
    },
    [hubBaseUrl, hubDown],
  );

  useImperativeHandle(
    ref,
    () => ({
      refreshAll: async (opts = {}) => {
        const plexRefresh = opts.plexRefresh !== false && allowPlexRefresh;
        await Promise.all([
          load({ forceVersions: true }),
          loadPlex(plexRefresh, { announce: false }),
        ]);
      },
      openCompanion: () => {
        setSheet("companion");
      },
    }),
    [allowPlexRefresh, load, loadPlex],
  );

  // Cached badge polls (no refresh=1). Skip initial plex fetch when a
  // startup refresh=1 will cover the first paint — avoids duplicate calls.
  useEffect(() => {
    if (!appActive) return;
    void load();
    if (!allowPlexRefresh) void loadPlex(false);
    if (hubDown) return;
    const timer = window.setInterval(() => {
      void load();
      void loadPlex(false);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [load, loadPlex, hubDown, allowPlexRefresh, appActive]);

  // One real check at home mount (refresh=1) when hub reachable (+ prefer LAN).
  // Reset when allowPlexRefresh recovers so reconnect gets a fresh check.
  useEffect(() => {
    if (!allowPlexRefresh) {
      didStartupRefresh.current = false;
      return;
    }
    if (didStartupRefresh.current) return;
    didStartupRefresh.current = true;
    void loadPlex(true);
  }, [allowPlexRefresh, loadPlex]);

  // Nice-to-have: refresh=1 when returning to foreground (throttled).
  useEffect(() => {
    if (!allowPlexRefresh) return;
    let sawBackground = false;
    const run = () => {
      if (!sawBackground) return;
      sawBackground = false;
      const now = Date.now();
      if (now - lastResumeRefreshAt.current < 60_000) return;
      lastResumeRefreshAt.current = now;
      void loadPlex(true);
    };
    let removeCap: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          sawBackground = true;
          return;
        }
        run();
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
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      removeCap?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [allowPlexRefresh, loadPlex]);

  useEffect(() => {
    if (hubDown) return;
    const busy = plexJobBusy(plexStatus?.job);
    if (!busy) return;
    const timer = window.setInterval(() => {
      if (plexJobPollInFlight.current) return;
      plexJobPollInFlight.current = true;
      void (async () => {
        try {
          const job = await fetchPlexUpdateJob(hubBaseUrl);
          setPlexStatus((prev) => (prev ? { ...prev, job } : prev));
          if (!plexJobBusy(job)) {
            const next = await fetchPlexUpdateStatus(hubBaseUrl);
            setPlexStatus(next);
            setPlexBusy(false);
            if (job.phase === "error") {
              setPlexError(job.error || job.message || "Plex update failed.");
            } else if (job.message) {
              setPlexActionMsg(job.message);
            }
          }
        } catch (err) {
          setPlexError(err instanceof Error ? err.message : String(err));
          setPlexBusy(false);
        } finally {
          plexJobPollInFlight.current = false;
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hubDown, hubBaseUrl, plexStatus?.job?.phase]);

  useEffect(() => {
    if (sheet !== "ombi" || hubDown) return;
    let cancelled = false;
    setOmbiLoading(true);
    setOmbiError(null);
    void (async () => {
      try {
        const result = await fetchOmbiPending(hubBaseUrl, services, resolveUrl);
        if (cancelled) return;
        if (!result) {
          setOmbiError("Could not load Ombi pending.");
          setOmbiItems([]);
        } else {
          setOmbiItems(result.items);
          setOmbiError(result.error || null);
          if (typeof result.pending === "number") {
            setSummary((prev) =>
              prev
                ? {
                    ...prev,
                    ombi: {
                      ok: result.ok,
                      configured: result.configured,
                      pending: result.pending,
                      error: result.error,
                    },
                  }
                : prev,
            );
          }
        }
      } finally {
        if (!cancelled) setOmbiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheet, hubDown, hubBaseUrl, services, resolveUrl]);

  useEffect(() => {
    if (!sheet) return;
    const onDoc = (event: MouseEvent) => {
      const el = sheetRef.current;
      if (el && !el.contains(event.target as Node)) setSheet(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  useAndroidBackHandler(() => {
    if (!sheet) return false;
    setSheet(null);
    return true;
  }, Boolean(sheet));

  const startStackAppUpdate = useCallback(
    async (appId: string, pcId?: string) => {
      if (!CLICK_UPDATE_APP_IDS.has(appId)) return;
      setAppUpdateNotice(null);
      setAppUpdateJobs((prev) => ({
        ...prev,
        [appId]: {
          id: null,
          appId,
          phase: "running",
          message: "Starting update…",
          error: null,
        },
      }));
      try {
        const job = await startAppUpdate(
          hubBaseUrl,
          appId,
          services,
          resolveUrl,
          pcId,
        );
        setAppUpdateJobs((prev) => ({ ...prev, [appId]: job }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setAppUpdateJobs((prev) => ({
          ...prev,
          [appId]: {
            id: null,
            appId,
            phase: "error",
            message,
            error: message,
          },
        }));
        setAppUpdateNotice(message);
      }
    },
    [hubBaseUrl, services, resolveUrl],
  );

  const runningAppUpdateKey = Object.entries(appUpdateJobs)
    .filter(([, job]) => job.phase === "running")
    .map(([id]) => id)
    .sort()
    .join("|");

  useEffect(() => {
    if (!runningAppUpdateKey || hubDown) return;
    const runningIds = runningAppUpdateKey.split("|").filter(Boolean);

    let cancelled = false;
    const poll = async () => {
      for (const appId of runningIds) {
        const job = await fetchAppUpdateJob(hubBaseUrl, appId);
        if (cancelled || !job) continue;
        setAppUpdateJobs((prev) => ({ ...prev, [appId]: job }));
        if (job.phase === "done") {
          setAppUpdateNotice(job.message || "Update started.");
          void load();
        } else if (job.phase === "error") {
          setAppUpdateNotice(job.error || job.message || "Update failed.");
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runningAppUpdateKey, hubDown, hubBaseUrl, load]);

  const streams = summary?.streams?.streamCount ?? nowPlaying?.length ?? null;
  const transcodingCount = (nowPlaying ?? []).filter((s) => s.isTranscoding).length;
  const downloads = summary?.downloads?.active ?? null;
  const ombiPending = summary?.ombi?.pending ?? null;
  const queueTotal = summary?.arr?.queueTotal ?? null;
  const pendingSummary = !hubDown && summary == null;
  const pendingGlyph = pendingSummary ? "…" : "—";
  const pendingPlex =
    !hubDown && plexStatus == null && (plexLoading || plexChecking);

  const onlineModules = modules.filter((m) => m.up === true);
  const offlineModules = modules.filter((m) => m.up === false);

  const plexJob = plexStatus?.job;
  const plexChipValue = (() => {
    if (hubDown) return "—";
    if (plexChecking || pendingPlex) return "…";
    if (!plexStatus) return "—";
    if (plexJobBusy(plexJob)) {
      return `${Math.round(plexJob?.progress ?? 0)}%`;
    }
    if (plexStatus.updateAvailable) return "upd";
    if (plexStatus.ok && plexStatus.installedVersion) return "ok";
    if (plexStatus.error) return "err";
    return "—";
  })();

  const plexChipTone: ChipTone = (() => {
    if (hubDown || !plexStatus) return "muted";
    if (plexChecking) return "accent";
    if (plexJobBusy(plexJob) || plexJob?.phase === "error") return "warn";
    if (plexStatus.updateAvailable) return "warn";
    if (plexStatus.ok && (!plexStatus.error || plexStatus.updateAvailable))
      return "good";
    return "muted";
  })();

  const installBlockedReason = (() => {
    if (hubDown) return "Hub offline — cannot check or install updates.";
    if (!plexStatus?.updateAvailable) return null;
    if (!plexStatusAllowsInstall(plexStatus)) {
      if (plexStatus.hubLocal === false) {
        return "Hub is not on the PMS PC — set Plex URL to localhost on that machine, or update from Plex Settings there.";
      }
      return plexInstallBlockedDetail(plexStatus);
    }
    return null;
  })();

  // Install runs on the hub/PMS PC via API — WAN is fine when hub is reachable.
  const canRunInstall =
    !hubDown &&
    plexStatusAllowsInstall(plexStatus) &&
    Boolean(plexStatus?.updateAvailable);

  const remoteInstall =
    onHomeNetwork !== true && canRunInstall;

  const companionHealth = useMemo(() => {
    const map: Record<string, { up: boolean | null; message?: string }> = {};
    for (const mod of modules) {
      map[mod.id] = { up: mod.up };
    }
    const hubServices = hubWatchdog?.services;
    if (hubServices) {
      for (const svc of services) {
        const row = hubStatusForService(hubServices, svc.id);
        if (!row) continue;
        const existing = map[svc.id];
        if (!existing || existing.up == null) {
          map[svc.id] = { up: row.up, message: row.message };
        }
      }
      for (const [id, row] of Object.entries(hubServices)) {
        if (!map[id]) map[id] = { up: row.up, message: row.message };
      }
    }
    return map;
  }, [modules, hubWatchdog?.services, services]);

  const companionStatus = useMemo(
    () =>
      buildCompanionPcStatus(
        hubWatchdog?.settingsPcs ?? [],
        hubWatchdog?.pcs ?? {},
        companionHealth,
        hubWatchdog?.watchServices ?? {},
        services,
        resolveUrl,
      ),
    [
      hubWatchdog?.settingsPcs,
      hubWatchdog?.pcs,
      hubWatchdog?.watchServices,
      companionHealth,
      services,
      resolveUrl,
    ],
  );

  const companionChip = useMemo(
    () => companionChipMeta(companionStatus, scanning),
    [companionStatus, scanning],
  );

  const arrUpdateCount = chipVersions?.hub?.arrUpdateCount ?? 0;
  const arrStatusRows = chipVersions?.arrs ?? [];
  const arrUpdates = arrStatusRows.filter((entry) => entry.updateAvailable);
  const companionAppVersions = chipVersions?.companion?.apps ?? [];
  const companionAppUpdateCount =
    chipVersions?.companion?.appUpdateCount ??
    companionAppVersions.filter((entry) => entry.updateAvailable).length;
  const companionAppUpdates = companionAppVersions.filter(
    (entry) => entry.updateAvailable,
  );

  const hubChipValue = scanning
    ? "…"
    : hubReachable === true
      ? arrUpdateCount > 0
        ? arrUpdateCount === 1
          ? "upd"
          : `${arrUpdateCount} upd`
        : "Up"
      : hubReachable === false
        ? "Down"
        : "—";
  const hubChipTone: ChipTone =
    hubReachable === true && arrUpdateCount > 0
      ? "warn"
      : hubReachable === true
        ? "good"
        : hubReachable === false
          ? "bad"
          : "muted";

  const runPlexAction = async (
    body: { download?: boolean; apply?: boolean; tonight?: boolean },
    confirmApply: boolean,
  ) => {
    if (confirmApply) {
      const tonight = Boolean(body.tonight);
      const remoteNote =
        onHomeNetwork !== true
          ? "\n\nYou’re remote; install still runs on the Plex PC via the hub (phone only calls the API)."
          : "";
      const ok = window.confirm(
        (tonight
          ? "Schedule Plex Media Server update for tonight (Butler)? Active streams may still be interrupted when it applies."
          : "Apply Plex Media Server update now? PMS will restart and active streams will disconnect.") +
          remoteNote,
      );
      if (!ok) return;
    }
    setPlexBusy(true);
    setPlexError(null);
    setPlexActionMsg(null);
    try {
      const { job } = await startPlexUpdateJob(hubBaseUrl, body);
      setPlexStatus((prev) =>
        prev
          ? { ...prev, job }
          : {
              ok: true,
              installedVersion: null,
              latestVersion: null,
              updateAvailable: false,
              channel: null,
              canInstall: false,
              releaseState: null,
              lastChecked: null,
              error: null,
              job,
            },
      );
      if (!plexJobBusy(job)) {
        setPlexBusy(false);
        setPlexActionMsg(job.message || "Done.");
        await loadPlex(false);
      }
    } catch (err) {
      setPlexBusy(false);
      setPlexError(err instanceof Error ? err.message : String(err));
    }
  };

  const chips: {
    id: string;
    label: string;
    value: string;
    tone: ChipTone;
    title: string;
    version?: string | null;
  }[] = [
    {
      id: "hub",
      label: "Hub",
      value: hubChipValue,
      tone: hubChipTone,
      title:
        arrUpdateCount > 0
          ? `Arrs Hub — ${arrUpdateCount} *arr update(s) available`
          : "Arrs Hub connectivity",
      version: chipVersions?.hub?.version || hubVersion || null,
    },
    ...(companionStatus && companionChip
      ? [
          {
            id: "companion",
            label: companionStatus.pc.name || "Companion",
            value:
              companionAppUpdateCount > 0 && companionChip.tone !== "bad"
                ? companionAppUpdateCount === 1
                  ? "upd"
                  : `${companionAppUpdateCount} upd`
                : companionChip.value,
            tone: (companionAppUpdateCount > 0 && companionChip.tone !== "bad"
              ? "warn"
              : companionChip.tone) as ChipTone,
            title: `${companionStatus.pc.name} Companion PC — tap for app status`,
            version: chipVersions?.companion?.version || null,
          },
        ]
      : []),
    {
      id: "up",
      label: "Up",
      value: scanning ? "…" : String(upCount),
      tone: scanning ? "muted" : upCount > 0 ? "good" : "muted",
      title: "Online modules",
    },
    {
      id: "down",
      label: "Down",
      value: scanning ? "…" : String(downCount),
      tone: scanning ? "muted" : downCount > 0 ? "bad" : "good",
      title: "Offline modules",
    },
    {
      id: "streams",
      label: "Streams",
      value: hubDown
        ? "—"
        : pendingSummary || streams == null
          ? pendingGlyph
          : summary?.streams?.configured
            ? String(streams)
            : "setup",
      tone:
        streams && streams > 0
          ? transcodingCount > 0
            ? "warn"
            : "accent"
          : summary?.streams?.configured
            ? "muted"
            : "warn",
      title:
        transcodingCount > 0
          ? `Open Streams (Tautulli) — ${transcodingCount} transcoding`
          : "Open Streams (Tautulli)",
    },
    {
      id: "downloads",
      label: "Downloads",
      value: hubDown
        ? "—"
        : pendingSummary || downloads == null
          ? pendingGlyph
          : summary?.downloads?.qbittorrent?.configured ||
              summary?.downloads?.sabnzbd?.configured
            ? String(downloads)
            : "setup",
      tone: downloads && downloads > 0 ? "accent" : "muted",
      title: "Active downloads",
    },
    {
      id: "queue",
      label: "*arr queue",
      value: hubDown
        ? "—"
        : pendingSummary || queueTotal == null
          ? pendingGlyph
          : summary?.arr?.sonarr?.ok ||
              summary?.arr?.radarr?.ok ||
              summary?.arr?.lidarr?.ok ||
              summary?.arr?.readarr?.ok ||
              summary?.arr?.whisparr?.ok
            ? String(queueTotal)
            : "setup",
      tone: queueTotal && queueTotal > 0 ? "warn" : "muted",
      title: "*arr queue — open Activity Queue",
    },
    ...(arrHealth && arrHealth.checked > 0
      ? [
          {
            id: "health",
            label: "Health",
            value:
              arrHealth.issues.length + arrHealth.lowDisk.length > 0
                ? String(arrHealth.issues.length + arrHealth.lowDisk.length)
                : "OK",
            tone: (arrHealth.issues.some((i) => i.type === "error")
              ? "bad"
              : arrHealth.issues.length || arrHealth.lowDisk.length
                ? "warn"
                : "good") as ChipTone,
            title: "*arr health checks + free disk space",
          },
        ]
      : []),
    {
      id: "ombi",
      label: "Ombi pending",
      value: hubDown
        ? "—"
        : pendingSummary || ombiPending == null
          ? pendingGlyph
          : summary?.ombi?.configured
            ? String(ombiPending)
            : "setup",
      tone:
        ombiPending && ombiPending > 0
          ? "warn"
          : summary?.ombi?.configured
            ? "good"
            : "muted",
      title: "Ombi pending approvals",
    },
    {
      id: "plex",
      label: "Plex",
      value: plexChipValue,
      tone: plexChipTone,
      title: "Plex Media Server update",
    },
    ...((wolTargets.plex || wolTargets.downloader)
      ? [
          {
            id: "wol",
            label: "WOL PCs",
            value: String(
              Number(wolTargets.plex) + Number(wolTargets.downloader),
            ),
            tone: (wolWarnRemote ? "warn" : "accent") as ChipTone,
            title: "Wake-on-LAN — turn on Plex / Downloader PCs",
          },
        ]
      : []),
  ];

  const arrApps: {
    id: "sonarr" | "radarr" | "lidarr";
    label: string;
    data?: ArrQueueApp;
  }[] = [
    { id: "sonarr", label: "Sonarr", data: summary?.arr?.sonarr },
    { id: "radarr", label: "Radarr", data: summary?.arr?.radarr },
    { id: "lidarr", label: "Lidarr", data: summary?.arr?.lidarr },
  ];

  const problemItems = arrApps.flatMap((app) =>
    (app.data?.issues ?? []).map((issue) => ({
      appId: app.id,
      appLabel: app.label,
      issue,
    })),
  );

  const openSheet = (id: Exclude<SheetId, null>) => {
    setSheet((prev) => (prev === id ? null : id));
  };

  const openArrActivity = (appId: string) => {
    setSheet(null);
    // Prefer native ArrPanel Activity Queue tab.
    onOpenService(appId, { initialTab: "queue" });
  };

  const reloadOmbiPending = useCallback(async () => {
    const result = await fetchOmbiPending(hubBaseUrl, services, resolveUrl);
    if (!result) {
      setOmbiError("Could not load Ombi pending.");
      setOmbiItems([]);
      return;
    }
    setOmbiItems(result.items);
    setOmbiError(result.error || null);
    if (typeof result.pending === "number") {
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              ombi: {
                ok: result.ok,
                configured: result.configured,
                pending: result.pending,
                error: result.error,
              },
            }
          : prev,
      );
    }
  }, [hubBaseUrl, services, resolveUrl]);

  const approveOmbi = async (item: OmbiPendingItem) => {
    const key = `${item.type}-${item.id}`;
    setOmbiApprovingId(key);
    setOmbiError(null);
    try {
      await approveOmbiRequest(hubBaseUrl, item, services, resolveUrl);
      // Drop immediately so success is visible even before refresh returns.
      setOmbiItems((prev) =>
        prev.filter((row) => !(row.type === item.type && row.id === item.id)),
      );
      setSummary((prev) =>
        prev?.ombi
          ? {
              ...prev,
              ombi: {
                ...prev.ombi,
                pending: Math.max(0, (prev.ombi.pending ?? 1) - 1),
              },
            }
          : prev,
      );
      await Promise.all([reloadOmbiPending(), load()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOmbiError(msg);
    } finally {
      setOmbiApprovingId(null);
    }
  };

  const denyOmbi = async (item: OmbiPendingItem) => {
    const ombiService = services.find((s) => s.id === "ombi");
    const key = `${item.type}-${item.id}`;
    setOmbiApprovingId(key);
    setOmbiError(null);
    try {
      const viaHub = hubBaseUrl.trim()
        ? await denyOmbiRequestViaHub(hubBaseUrl, item, services, resolveUrl)
        : false;
      if (!viaHub) {
        if (!ombiService?.url.trim() || !ombiService.apiKey.trim()) {
          throw new Error(
            "This Hub can’t deny yet — update Hub, or add Ombi URL + API key in Settings.",
          );
        }
        await denyOmbiRequestDirect(
          { ...ombiService, url: resolveUrl(ombiService) },
          { type: item.type, id: item.id },
        );
      }
      setOmbiItems((prev) =>
        prev.filter((row) => !(row.type === item.type && row.id === item.id)),
      );
      setSummary((prev) =>
        prev?.ombi
          ? {
              ...prev,
              ombi: {
                ...prev.ombi,
                pending: Math.max(0, (prev.ombi.pending ?? 1) - 1),
              },
            }
          : prev,
      );
      await Promise.all([reloadOmbiPending(), load()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOmbiError(msg);
    } finally {
      setOmbiApprovingId(null);
    }
  };

  const sheetTitle =
    sheet === "hub"
      ? "Arrs Hub"
      : sheet === "companion"
        ? companionStatus?.pc.name
          ? `${companionStatus.pc.name} Companion`
          : "Companion"
        : sheet === "up"
          ? "Online modules"
          : sheet === "down"
            ? "Offline modules"
            : sheet === "queue"
              ? "Queue by app"
              : sheet === "downloads"
                ? "Active downloads"
                : sheet === "ombi"
                  ? "Ombi pending"
                  : sheet === "plex"
                    ? "Plex Media Server"
                    : sheet === "wol"
                      ? "WOL PCs"
                      : sheet === "health"
                        ? "*arr health"
                        : "";

  const onChipClick = (chipId: string) => {
    if (chipId === "streams") {
      setSheet(null);
      onOpenStreams();
      return;
    }
    if ((SHEET_CHIPS as readonly string[]).includes(chipId)) {
      openSheet(chipId as Exclude<SheetId, null>);
    }
  };

  return (
    <section className="dash-status" aria-label="Hub status summary">
      <div className="dash-chips">
        {chips.map((chip) => {
          const expandsSheet = (SHEET_CHIPS as readonly string[]).includes(
            chip.id,
          );
          const expanded = expandsSheet && sheet === chip.id;
          return (
            <div key={chip.id} className="dash-chip-wrap">
              <button
                type="button"
                className={`dash-chip dash-chip-btn tone-${chip.tone}${
                  expanded ? " is-active" : ""
                }`}
                title={chip.title}
                aria-expanded={expandsSheet ? expanded : undefined}
                aria-haspopup={expandsSheet ? "dialog" : undefined}
                onClick={() => onChipClick(chip.id)}
              >
                <span className="dash-chip-value">{chip.value}</span>
                <span className="dash-chip-label">{chip.label}</span>
                {chip.version ? (
                  <span className="dash-chip-meta">v{chip.version}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>

      <p
        className={`dash-status-hint dash-path-hint${
          pathHint === "LAN" ? " is-lan" : ""
        }`}
        aria-live="polite"
      >
        {pathHint}
      </p>

      {hubDown && (
        <p className="dash-status-hint">
          Hub offline — activity chips show —. Module cards still probe.
        </p>
      )}

      {nowPlaying && nowPlaying.length > 0 && (
        <div className="home-now-playing" aria-label="Now playing">
          {nowPlaying.map((s) => (
            <button
              key={s.sessionKey}
              type="button"
              className={`home-np-card${s.isTranscoding ? " is-transcoding" : ""}`}
              onClick={onOpenStreams}
              title={s.fullTitle}
            >
              {s.posterUrl ? (
                <img className="home-np-poster" src={s.posterUrl} alt="" loading="lazy" />
              ) : (
                <span className="home-np-poster placeholder" aria-hidden>
                  ▶
                </span>
              )}
              <span className="home-np-body">
                <strong>{s.displayTitle || s.title}</strong>
                <small>
                  {s.user}
                  {s.isTranscoding ? " · transcoding" : ""}
                </small>
                <span className="home-np-progress">
                  <span style={{ width: `${Math.min(100, s.progressPercent)}%` }} />
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {upcoming && upcoming.length > 0 && (
        <div className="home-upcoming" aria-label="Upcoming this week">
          <p className="dash-chip-popover-title">Upcoming · next 7 days</p>
          <ul>
            {upcoming.slice(0, 6).map((item) => (
              <li key={`${item.appId}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenService(item.appId, { initialTab: "calendar" })}
                >
                  <span className="home-upcoming-when">
                    {formatScheduleWhen(item.airDateUtc, item.releaseDate)}
                  </span>
                  <span className="home-upcoming-title">
                    {item.title}
                    {item.subtitle ? <small> · {item.subtitle}</small> : null}
                  </span>
                  <span className="home-upcoming-app">{item.appName}</span>
                </button>
              </li>
            ))}
          </ul>
          {upcoming.length > 6 && (
            <p className="dash-status-hint">+{upcoming.length - 6} more in each app’s Calendar tab</p>
          )}
        </div>
      )}

      {sheet && (
        <div className="dash-sheet-scrim" role="presentation">
          <div
            className="dash-sheet"
            role="dialog"
            aria-label={sheetTitle}
            ref={sheetRef}
          >
            <div className="dash-sheet-head">
              <strong>{sheetTitle}</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => setSheet(null)}
              >
                ✕
              </button>
            </div>

            {sheet === "health" && arrHealth && (
              <>
                {arrHealth.issues.length === 0 ? (
                  <p className="dash-chip-popover-empty">No health warnings.</p>
                ) : (
                  <ul className="dash-queue-issues">
                    {arrHealth.issues.map((issue, i) => (
                      <li key={`${issue.appId}-${i}`}>
                        <div className="dash-queue-issue-main">
                          <span className="dash-queue-issue-badge">
                            {issue.appName} · {issue.type === "error" ? "Error" : "Warning"}
                          </span>
                          <span className="dash-queue-issue-title">{issue.message}</span>
                        </div>
                        <button
                          type="button"
                          className="dash-queue-issue-link"
                          onClick={() => {
                            setSheet(null);
                            onOpenService(issue.appId);
                          }}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {arrHealth.disks.length > 0 && (
                  <>
                    <p className="dash-chip-popover-title">Free space</p>
                    <ul className="dash-queue-breakdown">
                      {arrHealth.disks.map((d) => {
                        const pct = Math.round((d.freeSpace / d.totalSpace) * 100);
                        return (
                          <li key={d.path} className={isLowDisk(d) ? "is-low-disk" : undefined}>
                            <span title={d.appNames.join(", ")}>{d.label || d.path}</span>
                            <strong>
                              {formatBytes(d.freeSpace)} · {pct}%
                            </strong>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {arrHealth.failed.length > 0 && (
                  <p className="dash-chip-popover-hint">
                    Couldn’t reach: {arrHealth.failed.join(", ")}
                  </p>
                )}
              </>
            )}

            {sheet === "hub" && (
              <>
                <ul className="dash-queue-breakdown dash-plex-versions">
                  <li>
                    <span>Status</span>
                    <strong>
                      {hubReachable === true
                        ? hubLastError
                          ? "Up (auth)"
                          : "Up"
                        : hubReachable === false
                          ? "Down"
                          : "Unknown"}
                    </strong>
                  </li>
                  <li>
                    <span>Version</span>
                    <strong>
                      {hubVersion
                        ? `Hub ${hubVersion}`
                        : hubReachable === true
                          ? "Unknown"
                          : "Unreachable"}
                    </strong>
                  </li>
                  <li>
                    <span>URL</span>
                    <strong className="dash-hub-url">
                      {hubBaseUrl.trim() || "Not configured"}
                    </strong>
                  </li>
                  {hubLastError ? (
                    <li>
                      <span>Last error</span>
                      <strong>{hubLastError}</strong>
                    </li>
                  ) : null}
                  {summaryError ? (
                    <li>
                      <span>Activity</span>
                      <strong>{summaryError}</strong>
                    </li>
                  ) : null}
                  {hubWanUnauthWarning ? (
                    <li>
                      <span>Security</span>
                      <strong>
                        WAN Hub — control APIs lack auth until Hub API token is
                        set in Settings → Network
                      </strong>
                    </li>
                  ) : null}
                </ul>
                {arrStatusRows.length > 0 ? (
                  <>
                    <p className="dash-chip-popover-title">Stack versions</p>
                    <ul className="dash-queue-breakdown">
                      {arrStatusRows.map((app) => {
                        const job = appUpdateJobs[app.id];
                        const updating = job?.phase === "running";
                        const canClickUpdate =
                          Boolean(app.updateAvailable) &&
                          CLICK_UPDATE_APP_IDS.has(app.id) &&
                          !updating;
                        const value = updating
                          ? "updating…"
                          : job?.phase === "error"
                            ? "err"
                            : !app.configured
                              ? "need key"
                              : !app.ok
                                ? app.error
                                  ? "err"
                                  : "—"
                                : app.updateAvailable
                                  ? app.version
                                    ? `${app.version} → upd ${app.latestVersion || "?"}`
                                    : `upd → ${app.latestVersion || "?"}`
                                  : app.version || "—";
                        return (
                          <li key={app.id}>
                            {canClickUpdate ? (
                              <button
                                type="button"
                                className="dash-sheet-row-btn dash-queue-app-update"
                                disabled={updating}
                                onClick={() =>
                                  void startStackAppUpdate(app.id)
                                }
                              >
                                <span>{app.label}</span>
                                <strong>{value}</strong>
                              </button>
                            ) : (
                              <span className="dash-queue-app-static">
                                <span>{app.label}</span>
                                <strong>{value}</strong>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {arrUpdates.length > 0 ? (
                      <p className="dash-chip-popover-hint dash-chip-popover-hint-warn">
                        Yellow *arr / Tautulli rows: tap to update in the
                        background via the hub.
                      </p>
                    ) : (
                      <p className="dash-chip-popover-hint">
                        Enabled *arr apps with a Home URL appear here.
                      </p>
                    )}
                  </>
                ) : null}
                {appUpdateNotice ? (
                  <p className="dash-chip-popover-hint">{appUpdateNotice}</p>
                ) : null}
                <p className="dash-chip-popover-hint">
                  Pull down on Home to refresh, or reconnect below.
                </p>
                {onReconnect ? (
                  <div className="dash-plex-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={reconnecting}
                      onClick={() => {
                        setSheet(null);
                        onReconnect();
                      }}
                    >
                      {reconnecting ? "Reconnecting…" : "Reconnect"}
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {sheet === "companion" && !companionStatus && (
              <p className="dash-chip-popover-empty">
                No Companion downloader PC registered on this hub yet.
              </p>
            )}

            {sheet === "companion" && companionStatus && (
              <>
                <p className="dash-chip-popover-title">
                  {companionStatus.pc.name}
                  {companionStatus.pc.host
                    ? ` · ${companionStatus.pc.host}`
                    : ""}
                </p>
                <ul className="dash-queue-breakdown">
                  <li>
                    <span className="dash-queue-app-static">
                      <span>Companion</span>
                      <strong>
                        {companionStatus.online === true
                          ? "Online"
                          : companionStatus.online === false
                            ? "Offline"
                            : "Checking…"}
                        {chipVersions?.companion?.version
                          ? ` · v${chipVersions.companion.version}`
                          : ""}
                      </strong>
                    </span>
                  </li>
                  {companionStatus.pc.companionUrl ? (
                    <li>
                      <span className="dash-queue-app-static">
                        <span>LAN API</span>
                        <strong>
                          {companionStatus.pc.companionUrl.replace(
                            /^https?:\/\//,
                            "",
                          )}
                        </strong>
                      </span>
                    </li>
                  ) : null}
                </ul>
                {companionStatus.message ? (
                  <p className="dash-chip-popover-hint">
                    {companionStatus.message}
                  </p>
                ) : null}
                <p className="dash-chip-popover-title">Apps on this PC</p>
                {(() => {
                  const displayApps = mergeCompanionDisplayApps(
                    companionStatus.apps,
                    companionAppVersions,
                  );
                  if (displayApps.length === 0) {
                    return (
                      <p className="dash-chip-popover-empty">
                        No companion apps wired yet. In Hub Port Watch, set
                        Restart on → {companionStatus.pc.name} for qBit, SAB,
                        or FileFlows Node.
                      </p>
                    );
                  }
                  return (
                    <ul className="dash-queue-breakdown">
                      {displayApps.map((app) => {
                        const verInfo = companionAppVersions.find(
                          (entry) => entry.id === app.id,
                        );
                        const job = appUpdateJobs[app.id];
                        const updating = job?.phase === "running";
                        const health =
                          app.up === null && verInfo?.version
                            ? "installed"
                            : companionAppHealthLabel(app.up);
                        let value = health;
                        if (updating) {
                          value = "updating…";
                        } else if (job?.phase === "error") {
                          value = "err";
                        } else if (verInfo?.updateAvailable) {
                          value = `upd → ${verInfo.latestVersion || "?"}`;
                        } else if (verInfo?.version) {
                          value =
                            app.up === null
                              ? `v${verInfo.version}`
                              : `${health} · v${verInfo.version}`;
                        } else if (
                          verInfo &&
                          !verInfo.ok &&
                          verInfo.configured
                        ) {
                          value = `${health} · ver?`;
                        }
                        const hasUpdate = Boolean(verInfo?.updateAvailable);
                        const canClickUpdate =
                          hasUpdate &&
                          COMPANION_CLICK_UPDATE_IDS.has(app.id) &&
                          !updating;
                        const canOpen =
                          Boolean(app.openUrl) &&
                          app.id !== "fileflows-node" &&
                          app.id !== "surfshark";
                        const rowClass = hasUpdate || updating
                          ? "dash-sheet-row-btn dash-queue-app-update"
                          : "dash-sheet-row-btn";
                        const staticClass = [
                          "dash-queue-app-static",
                          hasUpdate || updating
                            ? "dash-queue-app-update"
                            : "",
                          updating ? "dash-queue-app-updating" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <li key={app.id}>
                            {canClickUpdate ? (
                              <button
                                type="button"
                                className={rowClass}
                                disabled={updating}
                                onClick={() =>
                                  void startStackAppUpdate(
                                    app.id,
                                    companionStatus.pc.id,
                                  )
                                }
                              >
                                <span>{app.label}</span>
                                <strong>{value}</strong>
                              </button>
                            ) : canOpen ? (
                              <button
                                type="button"
                                className={rowClass}
                                onClick={() => {
                                  setSheet(null);
                                  onOpenService(app.id);
                                }}
                              >
                                <span>{app.label}</span>
                                <strong>{value}</strong>
                              </button>
                            ) : (
                              <span
                                className={staticClass}
                                title={
                                  job?.error || app.message || undefined
                                }
                              >
                                <span>{app.label}</span>
                                <strong>{value}</strong>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
                {companionAppUpdates.length > 0 ? (
                  <p className="dash-chip-popover-hint dash-chip-popover-hint-warn">
                    {companionAppUpdates.some((a) =>
                      COMPANION_CLICK_UPDATE_IDS.has(a.id),
                    )
                      ? "Yellow qBit/SAB rows: tap to update in the background on this PC (winget via Companion)."
                      : `${companionAppUpdates.map((a) => a.label).join(", ")} have updates — install on ${companionStatus.pc.name}.`}
                  </p>
                ) : (
                  <p className="dash-chip-popover-hint">
                    Status from Hub Port Watch. FileFlows Node uses Companion
                    service/process probe (no web UI).
                  </p>
                )}
                {appUpdateNotice ? (
                  <p className="dash-chip-popover-hint">{appUpdateNotice}</p>
                ) : null}
              </>
            )}

            {sheet === "up" && (
              <>
                {onlineModules.length === 0 ? (
                  <p className="dash-chip-popover-empty">
                    No modules currently online.
                  </p>
                ) : (
                  <ul className="dash-queue-breakdown">
                    {onlineModules.map((mod) => (
                      <li key={mod.id}>
                        <button
                          type="button"
                          className="dash-sheet-row-btn"
                          onClick={() => {
                            setSheet(null);
                            onOpenService(mod.id);
                          }}
                        >
                          <span>{mod.name}</span>
                          <strong>Up</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {sheet === "down" && (
              <>
                {offlineModules.length === 0 ? (
                  <p className="dash-chip-popover-empty">
                    No modules currently offline.
                  </p>
                ) : (
                  <ul className="dash-queue-breakdown">
                    {offlineModules.map((mod) => (
                      <li key={mod.id}>
                        <button
                          type="button"
                          className="dash-sheet-row-btn"
                          onClick={() => {
                            setSheet(null);
                            onOpenService(mod.id);
                          }}
                        >
                          <span>{mod.name}</span>
                          <strong>Down</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {sheet === "queue" && (
              <>
                <ul className="dash-queue-breakdown">
                  {arrApps.map((app) => {
                    const configured =
                      app.data?.ok ||
                      app.data?.configured ||
                      Boolean(
                        services.find((s) => s.id === app.id && s.enabled),
                      );
                    const value = !configured
                      ? "—"
                      : app.data?.ok
                        ? String(app.data.total ?? 0)
                        : app.data?.error
                          ? "err"
                          : "—";
                    return (
                      <li key={app.id}>
                        <button
                          type="button"
                          className="dash-sheet-row-btn"
                          title={`Open ${app.label} Activity Queue`}
                          onClick={() => openArrActivity(app.id)}
                        >
                          <span>{app.label}</span>
                          <strong>{value}</strong>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="dash-chip-popover-title">Needs attention</p>
                {problemItems.length === 0 ? (
                  <p className="dash-chip-popover-empty">
                    No stuck / manual-import items in the first queue page.
                  </p>
                ) : (
                  <ul className="dash-queue-issues">
                    {problemItems.map(({ appId, appLabel, issue }) => (
                      <li key={`${appId}-${issue.id ?? issue.title}`}>
                        <div className="dash-queue-issue-main">
                          <span className="dash-queue-issue-badge">
                            {appLabel} · {issueBadge(issue)}
                          </span>
                          <span className="dash-queue-issue-title">
                            {issue.title}
                          </span>
                          {issue.errorMessage ? (
                            <span className="dash-queue-issue-msg">
                              {issue.errorMessage}
                            </span>
                          ) : null}
                          {issue.outputPath ? (
                            <span className="dash-queue-issue-path">
                              {issue.outputPath}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="dash-queue-issue-link"
                          onClick={() => openArrActivity(appId)}
                        >
                          Open Activity
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="dash-chip-popover-hint">
                  Tap an app (or Open Activity) for its in-app queue: retry
                  import, remove, blocklist &amp; search again. Manual matching
                  still needs the web UI.
                </p>
              </>
            )}

            {sheet === "downloads" && (
              <ul className="dash-queue-breakdown">
                {(
                  [
                    {
                      id: "qbittorrent",
                      label: "qBittorrent",
                      data: summary?.downloads?.qbittorrent,
                    },
                    {
                      id: "sabnzbd",
                      label: "SABnzbd",
                      data: summary?.downloads?.sabnzbd,
                    },
                  ] as const
                ).map((row) => {
                  const configured =
                    row.data?.configured ||
                    Boolean(
                      services.find((s) => s.id === row.id && s.enabled),
                    );
                  const value = !configured
                    ? "—"
                    : row.data?.ok
                      ? String(row.data.active ?? 0)
                      : "err";
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="dash-sheet-row-btn"
                        onClick={() => {
                          setSheet(null);
                          onOpenService(row.id);
                        }}
                      >
                        <span>{row.label}</span>
                        <strong>{value}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {sheet === "ombi" && (
              <>
                {!summary?.ombi?.configured && !hubDown ? (
                  <p className="dash-chip-popover-empty">
                    Add Ombi URL + API key in Settings, or open Ombi below.
                  </p>
                ) : ombiLoading && ombiItems.length === 0 ? (
                  <p className="dash-chip-popover-empty">Loading…</p>
                ) : ombiItems.length === 0 ? (
                  <p className="dash-chip-popover-empty">
                    No requests awaiting approval.
                  </p>
                ) : (
                  <ul className="dash-queue-issues">
                    {ombiItems.map((item) => {
                      const key = `${item.type}-${item.id}`;
                      const approving = ombiApprovingId === key;
                      return (
                        <li key={key}>
                          <div className="dash-queue-issue-main">
                            <span className="dash-queue-issue-badge">
                              {ombiTypeLabel(item.type)}
                              {item.requester ? ` · ${item.requester}` : ""}
                            </span>
                            <span className="dash-queue-issue-title">
                              {item.title}
                            </span>
                          </div>
                          <div className="dash-ombi-actions">
                            <button
                              type="button"
                              className="dash-ombi-approve"
                              disabled={
                                approving || ombiApprovingId != null || hubDown
                              }
                              onClick={() => void approveOmbi(item)}
                            >
                              {approving ? "…" : "Approve"}
                            </button>
                            <button
                              type="button"
                              className="dash-ombi-deny"
                              disabled={
                                approving || ombiApprovingId != null || hubDown
                              }
                              onClick={() => void denyOmbi(item)}
                            >
                              Deny
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {ombiError ? (
                  <p className="dash-chip-popover-error" role="alert">
                    Ombi error: {ombiError}
                  </p>
                ) : null}
                <p className="dash-chip-popover-hint">
                  Search &amp; request:{" "}
                  <button
                    type="button"
                    className="dash-queue-issue-link"
                    onClick={() => {
                      setSheet(null);
                      onOpenService("ombi");
                    }}
                  >
                    Open Ombi
                  </button>
                </p>
              </>
            )}

            {sheet === "plex" && (
              <>
                {hubDown ? (
                  <p className="dash-chip-popover-empty">
                    Hub offline — cannot reach Plex update status.
                  </p>
                ) : plexLoading && !plexStatus && !plexChecking ? (
                  <p className="dash-chip-popover-empty">Loading…</p>
                ) : (
                  <>
                    <ul className="dash-queue-breakdown dash-plex-versions">
                      <li>
                        <span>Installed</span>
                        <strong>
                          {shortPlexVersion(plexStatus?.installedVersion)}
                        </strong>
                      </li>
                      <li>
                        <span>Latest</span>
                        <strong>
                          {shortPlexVersion(plexStatus?.latestVersion)}
                        </strong>
                      </li>
                      <li>
                        <span>Status</span>
                        <strong>
                          {plexChecking
                            ? "Checking…"
                            : plexStatus?.updateAvailable
                              ? "Update available"
                              : plexStatus?.ok
                                ? "Up to date"
                                : "Unavailable"}
                        </strong>
                      </li>
                      {plexStatus?.channel ? (
                        <li>
                          <span>Source</span>
                          <strong>{plexStatus.channel}</strong>
                        </li>
                      ) : null}
                      {plexStatus?.releaseState ? (
                        <li>
                          <span>Release</span>
                          <strong>{plexStatus.releaseState}</strong>
                        </li>
                      ) : null}
                      {plexStatus?.lastChecked ? (
                        <li>
                          <span>Checked</span>
                          <strong>
                            {new Date(plexStatus.lastChecked).toLocaleString()}
                          </strong>
                        </li>
                      ) : null}
                    </ul>

                    {plexStatus?.updateAvailable ? (
                      <p className="dash-plex-badge" role="status">
                        Update available
                        {plexStatus.installMethod === "windows-installer"
                          ? " · Windows installer"
                          : plexStatusAllowsInstall(plexStatus)
                            ? ""
                            : " · install blocked"}
                      </p>
                    ) : null}

                    {plexJobBusy(plexJob) ||
                    plexJob?.phase === "done" ||
                    plexJob?.phase === "error" ? (
                      <div className="dash-plex-job" aria-live="polite">
                        <div className="dash-plex-job-row">
                          <span>{plexJob?.phase ?? "idle"}</span>
                          <strong>
                            {Math.round(plexJob?.progress ?? 0)}%
                          </strong>
                        </div>
                        {plexJob?.message ? (
                          <p className="dash-chip-popover-empty">
                            {plexJob.message}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {installBlockedReason ? (
                      <p className="dash-chip-popover-empty">
                        {installBlockedReason}
                      </p>
                    ) : null}
                    {remoteInstall ? (
                      <p className="dash-chip-popover-hint">
                        Remote session — Install still runs on the Plex PC via
                        the hub.
                      </p>
                    ) : null}

                    <div className="dash-plex-actions">
                      <button
                        type="button"
                        className="btn chip"
                        disabled={
                          hubDown ||
                          plexChecking ||
                          plexBusy ||
                          plexJobBusy(plexJob)
                        }
                        aria-busy={plexChecking}
                        onClick={() =>
                          void loadPlex(true, { announce: true })
                        }
                      >
                        {plexChecking ? "Checking…" : "Check"}
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          !canRunInstall ||
                          plexChecking ||
                          plexBusy ||
                          plexJobBusy(plexJob) ||
                          !plexStatus?.updateAvailable
                        }
                        title={
                          installBlockedReason ||
                          "Download and apply update now"
                        }
                        onClick={() =>
                          void runPlexAction(
                            { download: true, apply: true, tonight: false },
                            true,
                          )
                        }
                      >
                        Install
                      </button>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={
                          !canRunInstall ||
                          plexChecking ||
                          plexBusy ||
                          plexJobBusy(plexJob) ||
                          !plexStatus?.updateAvailable
                        }
                        title={
                          installBlockedReason ||
                          "Schedule update for tonight (Butler)"
                        }
                        onClick={() =>
                          void runPlexAction(
                            { download: true, apply: true, tonight: true },
                            true,
                          )
                        }
                      >
                        Tonight
                      </button>
                    </div>

                    {plexChecking ? (
                      <p className="dash-chip-popover-hint" aria-live="polite">
                        Checking for updates…
                      </p>
                    ) : null}
                    {plexActionMsg ? (
                      <p className="dash-chip-popover-hint" aria-live="polite">
                        {plexActionMsg}
                      </p>
                    ) : null}
                    {plexError ? (
                      <p className="dash-chip-popover-error">{plexError}</p>
                    ) : null}
                    <p className="dash-chip-popover-hint">
                      {plexStatus?.installMethod === "windows-installer"
                        ? "Updates download the Windows installer on the hub PC — the phone never downloads it."
                        : "Updates run on the hub PC via PMS updater — the phone never downloads the installer."}
                    </p>
                  </>
                )}
              </>
            )}

            {sheet === "wol" && (
              <div className="dash-wol-sheet">
                <p className="dash-chip-popover-hint">
                  Send a Wake-on-LAN packet to a configured PC. Direct magic
                  packets need home LAN / VPN; otherwise Hub can relay when
                  reachable.
                </p>
                <div className="wol-btn-row" style={{ marginTop: "0.65rem" }}>
                  {wolTargets.plex ? (
                    <button
                      type="button"
                      className="btn primary wol-btn"
                      disabled={wakeBusyTarget !== null || !onWakeTarget}
                      onClick={() => onWakeTarget?.("plex")}
                    >
                      <IconPower size={18} color="currentColor" />
                      {wakeBusyTarget === "plex"
                        ? "Sending…"
                        : "Turn on Plex PC"}
                    </button>
                  ) : null}
                  {wolTargets.downloader ? (
                    <button
                      type="button"
                      className="btn primary wol-btn"
                      disabled={wakeBusyTarget !== null || !onWakeTarget}
                      onClick={() => onWakeTarget?.("downloader")}
                    >
                      <IconPower size={18} color="currentColor" />
                      {wakeBusyTarget === "downloader"
                        ? "Sending…"
                        : "Turn on Downloader PC"}
                    </button>
                  ) : null}
                </div>
                <p
                  className={
                    wolWarnRemote
                      ? "dash-chip-popover-hint dash-chip-popover-hint-warn"
                      : "dash-chip-popover-hint"
                  }
                  style={{ marginTop: "0.75rem" }}
                >
                  {wakeMessage ||
                    wolStatusHint ||
                    "UDP on home LAN / VPN · hub relay when away"}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
});
