import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHubStatusSummary,
  fetchOmbiPending,
  issueBadge,
  ombiTypeLabel,
  type ArrQueueApp,
  type HubStatusSummary,
  type OmbiPendingItem,
} from "./hubSummary";
import type { ServiceConfig } from "./services";

type ChipTone = "good" | "bad" | "accent" | "warn" | "muted";
type SheetId = "up" | "down" | "queue" | "downloads" | "ombi" | null;

export type HomeChipModule = {
  id: string;
  name: string;
  up: boolean | null;
};

type HomeStatusChipsProps = {
  hubBaseUrl: string;
  hubReachable: boolean | null;
  services: ServiceConfig[];
  resolveUrl: (service: ServiceConfig) => string;
  modules: HomeChipModule[];
  upCount: number;
  downCount: number;
  scanning: boolean;
  /** Non-clickable LAN / Remote hint from IP/CIDR detection. */
  pathHint: "LAN" | "Remote";
  onOpenStreams: () => void;
  onOpenService: (id: string) => void;
};

export function HomeStatusChips({
  hubBaseUrl,
  hubReachable,
  services,
  resolveUrl,
  modules,
  upCount,
  downCount,
  scanning,
  pathHint,
  onOpenStreams,
  onOpenService,
}: HomeStatusChipsProps) {
  const [summary, setSummary] = useState<HubStatusSummary | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [ombiItems, setOmbiItems] = useState<OmbiPendingItem[]>([]);
  const [ombiLoading, setOmbiLoading] = useState(false);
  const [ombiError, setOmbiError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const hubDown = hubReachable === false || !hubBaseUrl.trim();

  const load = useCallback(async () => {
    if (hubDown) {
      setSummary(null);
      return;
    }
    const next = await fetchHubStatusSummary(
      hubBaseUrl,
      services,
      resolveUrl,
    );
    setSummary(next);
  }, [hubBaseUrl, hubDown, services, resolveUrl]);

  useEffect(() => {
    void load();
    if (hubDown) return;
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [load, hubDown]);

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

  const onlineModules = modules.filter((m) => m.up === true);
  const offlineModules = modules.filter((m) => m.up === false);

  const chips: {
    id: string;
    label: string;
    value: string;
    tone: ChipTone;
    title: string;
  }[] = [
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
      label: "Queue",
      value: hubDown
        ? "—"
        : pendingSummary || queueTotal == null
          ? "—"
          : summary?.arr?.sonarr?.ok || summary?.arr?.radarr?.ok
            ? String(queueTotal)
            : "setup",
      tone: queueTotal && queueTotal > 0 ? "warn" : "muted",
      title: "*arr queue",
    },
    {
      id: "ombi",
      label: "Ombi",
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
      title: "Ombi pending",
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

  const sheetTitle =
    sheet === "up"
      ? "Online modules"
      : sheet === "down"
        ? "Offline modules"
        : sheet === "queue"
          ? "Queue by app"
          : sheet === "downloads"
            ? "Active downloads"
            : sheet === "ombi"
              ? "Ombi pending"
              : "";

  const onChipClick = (chipId: string) => {
    if (chipId === "streams") {
      setSheet(null);
      onOpenStreams();
      return;
    }
    if (
      chipId === "up" ||
      chipId === "down" ||
      chipId === "queue" ||
      chipId === "downloads" ||
      chipId === "ombi"
    ) {
      openSheet(chipId);
    }
  };

  return (
    <section className="dash-status" aria-label="Hub status summary">
      <div className="dash-chips">
        {chips.map((chip) => {
          const expandsSheet =
            chip.id === "up" ||
            chip.id === "down" ||
            chip.id === "queue" ||
            chip.id === "downloads" ||
            chip.id === "ombi";
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
                          onClick={() => {
                            setSheet(null);
                            onOpenService(app.id);
                          }}
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
                        </div>
                        <button
                          type="button"
                          className="dash-queue-issue-link"
                          onClick={() => {
                            setSheet(null);
                            onOpenService(appId);
                          }}
                        >
                          Open {appLabel}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
                    {ombiItems.map((item) => (
                      <li key={`${item.type}-${item.id}`}>
                        <div className="dash-queue-issue-main">
                          <span className="dash-queue-issue-badge">
                            {ombiTypeLabel(item.type)}
                            {item.requester ? ` · ${item.requester}` : ""}
                          </span>
                          <span className="dash-queue-issue-title">
                            {item.title}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {ombiError ? (
                  <p className="dash-chip-popover-error">{ombiError}</p>
                ) : null}
                <p className="dash-chip-popover-hint">
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
          </div>
        </div>
      )}
    </section>
  );
}
