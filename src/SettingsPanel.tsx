import type { Dispatch, SetStateAction } from "react";
import { IconEye, IconEyeOff } from "./icons";
import type { AppVersionInfo } from "./apkShare";
import { saveHubApiToken } from "./hubAuth";
import { savePhotoDumpApiKey } from "./photoDumpApi";
import { PhotoDumpQrScan } from "./PhotoDumpQrScan";
import type { PhotoDumpSetupPayload } from "./photoDumpSetupQr";
import { isWanHubUrl } from "./photoDumpSetupApply";
import {
  pathHintLabel,
  savePathSettings,
  type PathSettings,
} from "./pathing";
import { saveServices } from "./probe";
import type { ServiceConfig } from "./services";
import { APP_VERSION_LABEL } from "./version";
import {
  DEFAULT_HUB_PORT,
  buildHubBaseUrl,
  formatMacInput,
  normalizeHubPort,
  normalizeMac,
  resolveHomeCidr,
  saveWolSettings,
  splitHubHostAndPort,
  wolTargetLabel,
  type HomeNetworkStatus,
  type WolSettings,
} from "./wol";
export function SecretField({
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
  /** Persist from the input value — not stale React state (paste+blur race). */
  onBlur: (value: string) => void;
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
          onBlur={(e) => onBlur(e.target.value)}
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
    (service.id === "workouts" || service.id === "photo-dump") &&
    !service.url.trim()
      ? wolHubUrl
      : service.url;
  if (
    (service.id === "workouts" || service.id === "photo-dump") &&
    url.trim()
  ) {
    url = buildHubBaseUrl(url, wolHubPort);
  }
  return `${status} · ${hostSummary(url)}`;
}

export type SettingsPanelProps = {
  services: ServiceConfig[];
  setServices: Dispatch<SetStateAction<ServiceConfig[]>>;
  persist: (next: ServiceConfig[]) => Promise<void>;
  wol: WolSettings;
  setWol: Dispatch<SetStateAction<WolSettings>>;
  persistWol: (next: WolSettings) => Promise<void>;
  persistWolFromBlur: (patch: (prev: WolSettings) => WolSettings) => void;
  pathing: PathSettings;
  setPathing: Dispatch<SetStateAction<PathSettings>>;
  persistPathingFromBlur: (patch: (prev: PathSettings) => PathSettings) => void;
  connectionMode: Parameters<typeof pathHintLabel>[0];
  homeNet: HomeNetworkStatus | null;
  hubApiToken: string;
  setHubApiToken: Dispatch<SetStateAction<string>>;
  revealedSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  applyPhotoDumpSetup: (
    payload: PhotoDumpSetupPayload,
  ) => boolean | void | Promise<boolean | void>;
  settingsNetworkOpen: boolean;
  setSettingsNetworkOpen: Dispatch<SetStateAction<boolean>>;
  settingsWolOpen: boolean;
  setSettingsWolOpen: Dispatch<SetStateAction<boolean>>;
  settingsWolAdvanced: boolean;
  setSettingsWolAdvanced: Dispatch<SetStateAction<boolean>>;
  settingsServiceId: string | null;
  setSettingsServiceId: Dispatch<SetStateAction<string | null>>;
  appVersion: AppVersionInfo | null;
  setScreen: (screen: "modules" | "backup") => void;
  setShareMessage: Dispatch<SetStateAction<string | null>>;
  setTransferMessage: Dispatch<SetStateAction<string | null>>;
};

export function SettingsPanel({
  services,
  setServices,
  persist,
  wol,
  setWol,
  persistWol,
  persistWolFromBlur,
  pathing,
  setPathing,
  persistPathingFromBlur,
  connectionMode,
  homeNet,
  hubApiToken,
  setHubApiToken,
  revealedSecrets,
  toggleSecret,
  applyPhotoDumpSetup,
  settingsNetworkOpen,
  setSettingsNetworkOpen,
  settingsWolOpen,
  setSettingsWolOpen,
  settingsWolAdvanced,
  setSettingsWolAdvanced,
  settingsServiceId,
  setSettingsServiceId,
  appVersion,
  setScreen,
  setShareMessage,
  setTransferMessage,
}: SettingsPanelProps) {
  const networkSummary = (() => {
    const path = pathHintLabel(connectionMode);
    const hub = wol.hubUrl.trim()
      ? hostSummary(buildHubBaseUrl(wol.hubUrl, wol.hubPort))
      : "";
    if (pathing.homeBaseUrl.trim()) {
      return hub
        ? `${path} · base ${hostSummary(pathing.homeBaseUrl)} · Hub ${hub}`
        : `${path} · base ${hostSummary(pathing.homeBaseUrl)}`;
    }
    return hub ? `${path} · Hub ${hub}` : `${path} · Remote URLs only`;
  })();
  const wolPlexMac = normalizeMac(wol.plex.mac);
  const wolDlMac = normalizeMac(wol.downloader.mac);
  const wolSummary = wol.enabled
    ? [
        wol.plex.enabled
          ? wolPlexMac
            ? `Plex ${wolPlexMac}`
            : "Plex · MAC needed"
          : "Plex off",
        wol.downloader.enabled
          ? wolDlMac
            ? `DL ${wolDlMac}`
            : "DL · MAC needed"
          : "DL off",
      ].join(" · ")
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
            <p className="hint" style={{ padding: "0 0 0.5rem" }}>
              Path is automatic from your IP / home CIDR. Detected:{" "}
              {pathHintLabel(connectionMode)}.
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
                onBlur={(e) => {
                  const homeBaseUrl = e.target.value.trim();
                  persistPathingFromBlur((prev) => ({
                    ...prev,
                    homeBaseUrl,
                    connectionPreference: "auto",
                  }));
                }}
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
                  persistWolFromBlur((prev) => ({
                    ...prev,
                    hubUrl: host,
                    hubPort: port ?? prev.hubPort,
                  }));
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
                onBlur={(e) => {
                  const hubPort = normalizeHubPort(
                    e.target.value || DEFAULT_HUB_PORT,
                  );
                  persistWolFromBlur((prev) => ({ ...prev, hubPort }));
                }}
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
              Hub is optional. Used for Workouts, Photo Dump, and as the
              primary status source when configured; direct probes are backup
              if Hub is unreachable or a service is missing from the watchdog
              board. Opening Sonarr, Radarr, and other panels still goes
              direct — never through the hub.
            </p>
            <SecretField
              label="Photo dump API key"
              value={
                services.find((s) => s.id === "photo-dump")?.apiKey || ""
              }
              fieldKey="photo-dump:networkKey"
              revealed={!!revealedSecrets["photo-dump:networkKey"]}
              onToggle={toggleSecret}
              onChange={(apiKey) => {
                setServices((prev) =>
                  prev.map((s) =>
                    s.id === "photo-dump" ? { ...s, apiKey } : s,
                  ),
                );
              }}
              onBlur={(raw) => {
                const apiKey = raw.trim();
                setServices((prev) => {
                  const next = prev.map((s) =>
                    s.id === "photo-dump" ? { ...s, apiKey } : s,
                  );
                  void saveServices(next);
                  void savePhotoDumpApiKey(apiKey);
                  return next;
                });
              }}
            />
            <PhotoDumpQrScan onPayload={applyPhotoDumpSetup} />
            <p className="hint" style={{ padding: "0.35rem 0 0" }}>
              Required to browse/upload into the Hub photo-dump root (e.g.
              N:\PhoneDump). Scan the Hub setup QR after generating a key — newer
              Hub QRs also fill Hub API token below — or paste keys manually.
            </p>
            <SecretField
              label="Hub API token"
              value={hubApiToken}
              fieldKey="hub:apiToken"
              revealed={!!revealedSecrets["hub:apiToken"]}
              onToggle={toggleSecret}
              onChange={setHubApiToken}
              onBlur={(raw) => {
                const token = raw.trim();
                setHubApiToken(token);
                void saveHubApiToken(token);
              }}
            />
            <p className="hint" style={{ padding: "0.35rem 0 0" }}>
              Optional control-plane token (Hub Settings). Sent as{" "}
              <code>X-Arrs-Hub-Token</code> on status / WOL / Ombi / updates /
              workouts. Leave blank until Hub enables hub-auth — current Hub
              still works without it.
            </p>
            {isWanHubUrl(wol.hubUrl) && !hubApiToken.trim() ? (
              <p className="hint wol-warn" style={{ padding: "0.35rem 0 0" }}>
                Hub host looks like a public WAN address and no Hub API token
                is set. Control APIs (summary, WOL, Ombi approve, updates) are
                currently unauthenticated until you paste the Hub token (or
                Hub wires auth). Photo Dump still requires its own API key.
              </p>
            ) : null}
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
                Magic packet on home LAN / VPN · hub relay when away
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
            {(["plex", "downloader"] as const).map((targetKey) => {
              const target = wol[targetKey];
              const label = wolTargetLabel(targetKey);
              return (
                <div key={targetKey} className="card slim">
                  <div className="top-row" style={{ marginBottom: "0.45rem" }}>
                    <strong>{label}</strong>
                    <label
                      className="toggle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={(e) => {
                          void persistWol({
                            ...wol,
                            [targetKey]: {
                              ...target,
                              enabled: e.target.checked,
                            },
                          });
                        }}
                      />
                      <span>On</span>
                    </label>
                  </div>
                  <label className="field">
                    <span>Target MAC</span>
                    <input
                      value={target.mac}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      autoComplete="off"
                      spellCheck={false}
                      inputMode="text"
                      onChange={(e) => {
                        const mac = formatMacInput(e.target.value);
                        setWol((prev) => ({
                          ...prev,
                          [targetKey]: { ...prev[targetKey], mac },
                        }));
                      }}
                      onBlur={(e) => {
                        const mac = formatMacInput(e.target.value);
                        persistWolFromBlur((prev) => ({
                          ...prev,
                          [targetKey]: { ...prev[targetKey], mac },
                        }));
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>PC host / IP (optional)</span>
                    <input
                      value={target.targetHost}
                      placeholder={
                        targetKey === "plex"
                          ? "192.168.1.10"
                          : "192.168.1.20"
                      }
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setWol((prev) => ({
                          ...prev,
                          [targetKey]: {
                            ...prev[targetKey],
                            targetHost: e.target.value,
                          },
                        }))
                      }
                      onBlur={(e) => {
                        const targetHost = e.target.value;
                        persistWolFromBlur((prev) => ({
                          ...prev,
                          [targetKey]: { ...prev[targetKey], targetHost },
                        }));
                      }}
                    />
                  </label>
                  {settingsWolAdvanced && (
                    <label className="field">
                      <span>Hub PC id ({label})</span>
                      <input
                        value={target.hubPcId}
                        placeholder="pc-…"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) =>
                          setWol((prev) => ({
                            ...prev,
                            [targetKey]: {
                              ...prev[targetKey],
                              hubPcId: e.target.value,
                            },
                          }))
                        }
                        onBlur={(e) => {
                          const hubPcId = e.target.value;
                          persistWolFromBlur((prev) => ({
                            ...prev,
                            [targetKey]: { ...prev[targetKey], hubPcId },
                          }));
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
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
                    onBlur={(e) => {
                      const broadcastIp = e.target.value || "255.255.255.255";
                      persistWolFromBlur((prev) => ({ ...prev, broadcastIp }));
                    }}
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
                    onBlur={(e) => {
                      const port = Number(e.target.value) || 9;
                      persistWolFromBlur((prev) => ({ ...prev, port }));
                    }}
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
                    onBlur={(e) => {
                      const homeCidr = e.target.value;
                      persistWolFromBlur((prev) => ({ ...prev, homeCidr }));
                    }}
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
                      persistWolFromBlur((prev) => ({
                        ...prev,
                        hubUrl: host,
                        hubPort: port ?? prev.hubPort,
                      }));
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
                    onBlur={(e) => {
                      const hubPort = normalizeHubPort(
                        e.target.value || DEFAULT_HUB_PORT,
                      );
                      persistWolFromBlur((prev) => ({ ...prev, hubPort }));
                    }}
                  />
                </label>
                <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                  Same as Network → Arrs Hub. Port Arrs Hub listens on
                  (default {DEFAULT_HUB_PORT}). Relay wakes either PC via hub
                  when away from home.
                </p>
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
                      {service.id === "workouts" ||
                      service.id === "photo-dump"
                        ? "Arrs Hub host"
                        : "Remote URL"}
                    </span>
                    <input
                      type="url"
                      value={service.url}
                      placeholder={
                        service.id === "workouts" ||
                        service.id === "photo-dump"
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
                        const raw = e.target.value;
                        if (
                          service.id === "workouts" ||
                          service.id === "photo-dump"
                        ) {
                          const { host, port } = splitHubHostAndPort(raw);
                          setServices((prev) => {
                            const next = prev.map((s) =>
                              s.id === service.id
                                ? { ...s, url: host || raw.trim() }
                                : s,
                            );
                            void saveServices(next);
                            return next;
                          });
                          if (port != null) {
                            persistWolFromBlur((prev) => ({
                              ...prev,
                              hubPort: port,
                            }));
                          }
                          return;
                        }
                        setServices((prev) => {
                          void saveServices(prev);
                          return prev;
                        });
                      }}
                    />
                  </label>
                  {service.id === "workouts" ||
                  service.id === "photo-dump" ? (
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
                        {service.id === "photo-dump"
                          ? " Photo Dump uploads to Hub /api/photo-dump/* at this host/port."
                          : " Workouts need the hub online at this host/port (home LAN or forwarded remote / VPN)."}{" "}
                        Empty host falls back to Network → Arrs Hub host.
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
                  ) : service.id === "fileflows-node" ? (
                    <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                      No web UI — status comes from Arrs Hub Companion
                      (Windows service / process on the downloader PC).
                    </p>
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
                      label={
                      service.id === "photo-dump"
                        ? "Photo dump API key"
                        : service.id === "plex"
                          ? "Plex token (X-Plex-Token — for library scans)"
                          : "API key"
                      }
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
                      onBlur={(raw) => {
                        const apiKey = raw.trim();
                        const id = service.id;
                        setServices((prev) => {
                          const next = prev.map((s) =>
                            s.id === id ? { ...s, apiKey } : s,
                          );
                          void saveServices(next);
                          if (id === "photo-dump") {
                            void savePhotoDumpApiKey(apiKey);
                          }
                          return next;
                        });
                      }}
                    />
                  )}
                  {service.id === "photo-dump" && (
                    <>
                      <PhotoDumpQrScan onPayload={applyPhotoDumpSetup} />
                      <p className="hint" style={{ padding: "0.25rem 0 0" }}>
                        Scan the Hub setup QR (photo dump key + Hub API token
                        when Hub embeds both) or paste from Hub Settings → Photo
                        dump. Same field as Network → Photo
                        dump API key.
                      </p>
                    </>
                  )}
                  {service.id === "ombi" && (
                    <label className="field">
                      <span>Request as (Ombi username)</span>
                      <input
                        value={service.username}
                        placeholder="Optional — defaults to the API key owner"
                        autoCapitalize="none"
                        autoCorrect="off"
                        onChange={(e) =>
                          setServices((prev) =>
                            prev.map((s) =>
                              s.id === service.id
                                ? { ...s, username: e.target.value }
                                : s,
                            ),
                          )
                        }
                        onBlur={(e) => {
                          const username = e.target.value.trim();
                          setServices((prev) => {
                            const next = prev.map((s) =>
                              s.id === "ombi" ? { ...s, username } : s,
                            );
                            void saveServices(next);
                            return next;
                          });
                        }}
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
                          onBlur={(e) => {
                            const username = e.target.value;
                            const id = service.id;
                            setServices((prev) => {
                              const next = prev.map((s) =>
                                s.id === id ? { ...s, username } : s,
                              );
                              void saveServices(next);
                              return next;
                            });
                          }}
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
                        onBlur={(raw) => {
                          const password = raw;
                          const id = service.id;
                          setServices((prev) => {
                            const next = prev.map((s) =>
                              s.id === id ? { ...s, password } : s,
                            );
                            void saveServices(next);
                            return next;
                          });
                        }}
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
