import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  fetchHubStatusSummary,
  fetchOmbiPending,
  approveOmbiRequest,
  issueBadge,
  ombiTypeLabel,
  type ArrQueueApp,
  type HubStatusSummary,
  type OmbiPendingItem,
} from "./hubSummary";
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

/** Match desktop hub: *arr Activity Queue lives at /activity/queue. */
function activityQueueUrl(baseUrl: string | undefined): string | null {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return null;
  return `${trimmed.replace(/\/+$/, "")}/activity/queue`;
}

export type HomeStatusChipsHandle = {
  /** Re-fetch hub summary + plex (refresh=1 when allowed). */
  refreshAll: (opts?: { plexRefresh?: boolean }) => Promise<void>;
};

type ChipTone = "good" | "bad" | "accent" | "warn" | "muted";
type SheetId =
  | "hub"
  | "up"
  | "down"
  | "queue"
  | "downloads"
  | "ombi"
  | "plex"
  | null;

const SHEET_CHIPS = [
  "hub",
  "up",
  "down",
  "queue",
  "downloads",
  "ombi",
  "plex",
] as const satisfies readonly Exclude<SheetId, null>[];

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
  },
  ref,
) {
  const [summary, setSummary] = useState<HubStatusSummary | null>(null);
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

  const hubDown = hubReachable === false || !hubBaseUrl.trim();
  /** Same gate as chip probes: hub up; skip expensive refresh off home LAN. */
  const allowPlexRefresh = !hubDown && onHomeNetwork !== false;

  const load = useCallback(async () => {
    if (hubDown) {
      setSummary(null);
      setPlexStatus(null);
      return;
    }
    const next = await fetchHubStatusSummary(
      hubBaseUrl,
      services,
      resolveUrl,
    );
    setSummary(next);
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
          load(),
          loadPlex(plexRefresh, { announce: false }),
        ]);
      },
    }),
    [allowPlexRefresh, load, loadPlex],
  );

  // Cached badge polls (no refresh=1). Skip initial plex fetch when a
  // startup refresh=1 will cover the first paint — avoids duplicate calls.
  useEffect(() => {
    void load();
    if (!allowPlexRefresh) void loadPlex(false);
    if (hubDown) return;
    const timer = window.setInterval(() => {
      void load();
      void loadPlex(false);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [load, loadPlex, hubDown, allowPlexRefresh]);

  // One real check at home mount (refresh=1) when hub reachable (+ prefer LAN).
  useEffect(() => {
    if (!allowPlexRefresh) return;
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
      setOmbiLoading(false);
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

  const streams = summary?.streams?.streamCount ?? null;
  const downloads = summary?.downloads?.active ?? null;
  const ombiPending = summary?.ombi?.pending ?? null;
  const queueTotal = summary?.arr?.queueTotal ?? null;
  const pendingSummary = !hubDown && summary == null;
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

  const hubChipValue = scanning
    ? "…"
    : hubReachable === true
      ? "Up"
      : hubReachable === false
        ? "Down"
        : "—";
  const hubChipTone: ChipTone =
    hubReachable === true ? "good" : hubReachable === false ? "bad" : "muted";

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
  }[] = [
    {
      id: "hub",
      label: "Hub",
      value: hubChipValue,
      tone: hubChipTone,
      title: "Arrs Hub connectivity",
    },
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
          ? "—"
          : summary?.streams?.configured
            ? String(streams)
            : "setup",
      tone:
        streams && streams > 0
          ? "accent"
          : summary?.streams?.configured
            ? "muted"
            : "warn",
      title: "Open Streams (Tautulli)",
    },
    {
      id: "downloads",
      label: "Downloads",
      value: hubDown
        ? "—"
        : pendingSummary || downloads == null
          ? "—"
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
          ? "—"
          : summary?.arr?.sonarr?.ok || summary?.arr?.radarr?.ok
            ? String(queueTotal)
            : "setup",
      tone: queueTotal && queueTotal > 0 ? "warn" : "muted",
      title: "*arr queue — open Activity Queue",
    },
    {
      id: "ombi",
      label: "Ombi pending",
      value: hubDown
        ? "—"
        : pendingSummary || ombiPending == null
          ? "—"
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

  const openArrActivity = async (appId: string) => {
    const service = services.find((s) => s.id === appId && s.enabled);
    const openUrl = service
      ? activityQueueUrl(resolveUrl(service))
      : null;
    setSheet(null);
    if (!openUrl) {
      // No Home URL configured — fall back to in-app Arr Activity tab.
      onOpenService(appId, { initialTab: "queue" });
      return;
    }
    try {
      await Browser.open({ url: openUrl });
    } catch {
      window.open(openUrl, "_blank", "noopener,noreferrer");
    }
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

  const downloaderPcs = (hubWatchdog?.settingsPcs ?? []).filter(
    (pc) => pc.companionUrl || pc.companionId,
  );

  function companionStatusLabel(pcId: string): string {
    const live = hubWatchdog?.pcs[pcId];
    if (!live || live.online === null) return "Unknown";
    const msg = (live.message || "").toLowerCase();
    if (msg.includes("companion online") || live.method?.includes("companion")) {
      return "Online";
    }
    if (live.online === true) return "Online";
    return "Offline";
  }

  const sheetTitle =
    sheet === "hub"
      ? "Arrs Hub"
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

            {sheet === "hub" && (
              <>
                <ul className="dash-queue-breakdown dash-plex-versions">
                  <li>
                    <span>Status</span>
                    <strong>
                      {hubReachable === true
                        ? "Up"
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
                </ul>
                {downloaderPcs.length > 0 ? (
                  <>
                    <p className="dash-chip-popover-title">Downloader PCs</p>
                    <ul className="dash-queue-breakdown">
                      {downloaderPcs.map((pc) => {
                        const companionOnline = companionStatusLabel(pc.id);
                        return (
                          <li key={pc.id}>
                            <span>{pc.name || "Downloader PC"}</span>
                            <strong>
                              Companion {companionOnline}
                              {pc.lastRegisterAt
                                ? ` · ${new Date(pc.lastRegisterAt).toLocaleString()}`
                                : ""}
                            </strong>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : hubReachable === true ? (
                  <p className="dash-chip-popover-hint">
                    No Companion downloader PC registered on this hub yet.
                  </p>
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
                  Tap Sonarr / Radarr / Lidarr (or Open Activity) to open that
                  app&apos;s Activity Queue in the browser. Matching still
                  happens there.
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
                              {approving ? "Approving…" : "Approve"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {ombiError ? (
                  <p className="dash-chip-popover-error" role="alert">
                    Approve error: {ombiError}
                  </p>
                ) : null}
                <p className="dash-chip-popover-hint">
                  Fallback:{" "}
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
          </div>
        </div>
      )}
    </section>
  );
});
