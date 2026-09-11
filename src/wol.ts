import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { UdpSocket } from "capacitor-udp-socket";
import {
  HubAuthError,
  isHubAuthFailure,
  mergeHubAuthHeaders,
} from "./hubAuth";
import {
  cidrFromHomeBase,
  hostFromUrlOrHost,
  isPrivateIpv4,
} from "./pathing";

/** Capacitor Preferences key for Wake-on-LAN settings. */
export const WOL_STORAGE_KEY = "arrs-mobile-wol-v2";

/** Legacy key — migrated into v2 on load. */
export const WOL_STORAGE_KEY_LEGACY = "arrs-mobile-wol-v1";

/** Default TCP port Arrs Hub listens on (desktop). */
export const DEFAULT_HUB_PORT = 3000;

export type WolTargetKey = "plex" | "downloader";

export type WolTarget = {
  enabled: boolean;
  /** Target NIC MAC, e.g. AA:BB:CC:DD:EE:FF */
  mac: string;
  /** Optional host/IP used to guess directed broadcast */
  targetHost: string;
  /** Port Watch PC id when waking via hub relay */
  hubPcId: string;
};

export type WolSettings = {
  enabled: boolean;
  broadcastIp: string;
  port: number;
  /**
   * Home network CIDR (e.g. 192.168.1.0/24). Empty = derive /24 from
   * Settings → Home / LAN base, then WOL targetHost (private IPs only).
   */
  homeCidr: string;
  /**
   * Arrs Hub host / base (protocol + host, port optional).
   * Effective URL uses hubPort — e.g. http://192.168.1.10
   */
  hubUrl: string;
  /** TCP port Arrs Hub listens on (default 3000). Overrides any port in hubUrl. */
  hubPort: number;
  plex: WolTarget;
  downloader: WolTarget;
};

export type HomeNetworkStatus = {
  onHomeNetwork: boolean | null;
  connectionType: string;
  localIp: string | null;
  homeCidr: string;
  message: string;
  /** True when we should warn before sending (not clearly on home LAN). */
  warnRemote: boolean;
};

export type WakeResult = {
  ok: boolean;
  method: "direct" | "hub" | "none";
  message: string;
  mac?: string;
  addresses?: string[];
};

export const DEFAULT_WOL_TARGET: WolTarget = {
  enabled: true,
  mac: "",
  targetHost: "",
  hubPcId: "",
};

export const DEFAULT_WOL: WolSettings = {
  enabled: false,
  broadcastIp: "255.255.255.255",
  port: 9,
  homeCidr: "",
  hubUrl: "",
  hubPort: DEFAULT_HUB_PORT,
  plex: { ...DEFAULT_WOL_TARGET },
  downloader: { ...DEFAULT_WOL_TARGET },
};

export type WolWakeSettings = WolSettings & {
  mac: string;
  targetHost: string;
  hubPcId: string;
};

export function wolTargetLabel(key: WolTargetKey): string {
  return key === "plex" ? "Plex PC" : "Downloader PC";
}

export function targetWakeReady(target: WolTarget): boolean {
  return Boolean(normalizeMac(target.mac) || target.hubPcId.trim());
}

/** Flatten one target into legacy-shaped settings for wake helpers. */
export function settingsForTarget(
  settings: WolSettings,
  targetKey: WolTargetKey,
): WolWakeSettings {
  const target = settings[targetKey];
  return {
    ...settings,
    mac: target.mac,
    targetHost: target.targetHost,
    hubPcId: target.hubPcId,
  };
}

export function updateWolTarget(
  settings: WolSettings,
  targetKey: WolTargetKey,
  patch: Partial<WolTarget>,
): WolSettings {
  return {
    ...settings,
    [targetKey]: { ...settings[targetKey], ...patch },
  };
}

type HubPcSeed = {
  id?: string;
  name?: string;
  host?: string;
  mac?: string;
  companionUrl?: string;
  companionId?: string;
};

/** Fill blank MAC/host/pcId from Arrs Hub Port Watch PCs (does not overwrite user values). */
export function applyHubPcsToWolTargets(
  settings: WolSettings,
  pcs: HubPcSeed[],
): WolSettings {
  if (!pcs.length) return settings;

  let plex = { ...settings.plex };
  let downloader = { ...settings.downloader };

  const companionPc =
    pcs.find((pc) => pc.companionUrl || pc.companionId) ||
    pcs.find((pc) => /download|retro|qbit|sab/i.test(String(pc.name || "")));
  const plexPc =
    pcs.find(
      (pc) =>
        !pc.companionUrl &&
        !pc.companionId &&
        /plex|hub|media/i.test(String(pc.name || "")),
    ) || pcs.find((pc) => !pc.companionUrl && !pc.companionId);

  const fill = (target: WolTarget, pc: HubPcSeed | undefined): WolTarget => {
    if (!pc) return target;
    const mac = normalizeMac(pc.mac || "") || target.mac;
    return {
      ...target,
      mac: target.mac.trim() ? target.mac : mac || target.mac,
      targetHost: target.targetHost.trim()
        ? target.targetHost
        : String(pc.host || "").trim() || target.targetHost,
      hubPcId: target.hubPcId.trim()
        ? target.hubPcId
        : String(pc.id || "").trim() || target.hubPcId,
    };
  };

  plex = fill(plex, plexPc);
  downloader = fill(downloader, companionPc);

  return { ...settings, plex, downloader };
}

function normalizeWolTarget(raw: Partial<WolTarget> | undefined): WolTarget {
  return {
    enabled: raw?.enabled !== false,
    mac: String(raw?.mac ?? ""),
    targetHost: String(raw?.targetHost ?? ""),
    hubPcId: String(raw?.hubPcId ?? ""),
  };
}

export function normalizeWolSettings(raw: Partial<WolSettings> | undefined): WolSettings {
  const wolRaw = raw ?? {};
  const rawHubUrl = String(wolRaw.hubUrl ?? "");
  const hubParts = splitHubHostAndPort(rawHubUrl);
  const hubPort =
    wolRaw.hubPort != null
      ? normalizeHubPort(wolRaw.hubPort)
      : hubParts.port ?? DEFAULT_WOL.hubPort;

  const legacy = wolRaw as Partial<WolSettings> & {
    mac?: string;
    targetHost?: string;
    hubPcId?: string;
  };

  let plex = normalizeWolTarget(wolRaw.plex);
  let downloader = normalizeWolTarget(wolRaw.downloader);

  if (!wolRaw.plex && !wolRaw.downloader && (legacy.mac || legacy.targetHost || legacy.hubPcId)) {
    downloader = {
      ...downloader,
      mac: String(legacy.mac ?? ""),
      targetHost: String(legacy.targetHost ?? ""),
      hubPcId: String(legacy.hubPcId ?? ""),
    };
  }

  return {
    enabled: Boolean(wolRaw.enabled),
    broadcastIp: String(wolRaw.broadcastIp || DEFAULT_WOL.broadcastIp),
    port: Number(wolRaw.port) || DEFAULT_WOL.port,
    homeCidr: String(wolRaw.homeCidr ?? ""),
    hubUrl: hubParts.host || rawHubUrl,
    hubPort,
    plex,
    downloader,
  };
}

export function normalizeHubPort(port: unknown): number {
  const n = Number(port);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return DEFAULT_HUB_PORT;
  return Math.floor(n);
}

/**
 * Split a hub host/URL into host (no port) + optional port from the string.
 * Accepts bare hosts, IPs, or full URLs.
 */
export function splitHubHostAndPort(raw: string): {
  host: string;
  port: number | null;
} {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { host: "", port: null };
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    const port = u.port ? Number(u.port) : null;
    u.port = "";
    let host = u.toString();
    if (host.endsWith("/") && u.pathname === "/") {
      host = host.slice(0, -1);
    }
    return {
      host,
      port: port && Number.isFinite(port) && port > 0 ? port : null,
    };
  } catch {
    const m = trimmed.match(/^(.*):(\d{1,5})\/?$/);
    if (m) {
      return { host: m[1]!, port: Number(m[2]) };
    }
    return { host: trimmed, port: null };
  }
}

/** Build `http(s)://host:port` for Workouts / WOL hub relay. */
export function buildHubBaseUrl(
  hubUrl: string,
  hubPort: number = DEFAULT_HUB_PORT,
): string {
  const trimmed = String(hubUrl || "").trim();
  if (!trimmed) return "";
  const port = normalizeHubPort(hubPort);
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    u.port = String(port);
    let out = u.toString();
    if (out.endsWith("/") && u.pathname === "/") {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    const base = trimmed.replace(/\/+$/, "").replace(/:\d+$/, "");
    const withProto = /^https?:\/\//i.test(base) ? base : `http://${base}`;
    return `${withProto}:${port}`;
  }
}

/**
 * Live-format a MAC as the user types / pastes.
 * Strips non-hex, uppercases, inserts colons → AA:BB:CC:DD:EE:FF (max 6 octets).
 * Accepts pasted aabbccddeeff, aa-bb-cc-dd-ee-ff, aa:bb:…, etc.
 */
export function formatMacInput(raw: string): string {
  const hex = String(raw || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);
  const parts: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    parts.push(hex.slice(i, Math.min(i + 2, hex.length)));
  }
  return parts.join(":");
}

/** Normalize MAC to AA:BB:CC:DD:EE:FF (null if not exactly 6 octets). */
export function normalizeMac(mac: string): string | null {
  const formatted = formatMacInput(mac);
  if (formatted.replace(/:/g, "").length !== 12) return null;
  return formatted;
}

export function guessBroadcastAddress(host: string): string | null {
  const m = String(host || "").match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}.255`;
}

function parseIpv4(ip: string): number[] | null {
  const m = String(ip || "").match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

function ipv4ToInt(parts: number[]): number {
  return (
    ((parts[0]! << 24) >>> 0) +
    ((parts[1]! << 16) >>> 0) +
    ((parts[2]! << 8) >>> 0) +
    (parts[3]! >>> 0)
  );
}

/** Parse "a.b.c.d/nn" or bare IPv4 (treated as /24). */
export function parseCidr(cidr: string): { network: number; mask: number } | null {
  const raw = String(cidr || "").trim();
  if (!raw) return null;
  const [ipPart, prefixPart] = raw.split("/");
  const parts = parseIpv4(ipPart || "");
  if (!parts) return null;
  const prefix = prefixPart === undefined ? 24 : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipv4ToInt(parts) & mask;
  return { network, mask };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  const parts = parseIpv4(ip);
  if (!parsed || !parts) return false;
  return (ipv4ToInt(parts) & parsed.mask) === parsed.network;
}

export function hostFromUrl(url: string): string | null {
  return hostFromUrlOrHost(url);
}

/**
 * Resolve home LAN CIDR for “are we home?” detection.
 * Prefers explicit CIDR, then Home/LAN base URL, then private targetHost.
 * Never derives from the public remote WAN IP (that breaks LAN matching).
 */
export function resolveHomeCidr(
  settings: WolSettings,
  homeBaseUrl = "",
): string {
  const explicit = settings.homeCidr.trim();
  if (explicit) return explicit.includes("/") ? explicit : `${explicit}/24`;

  const fromHome = cidrFromHomeBase(homeBaseUrl);
  if (fromHome) return fromHome;

  const target =
    parseIpv4(settings.downloader.targetHost.trim())?.join(".") ||
    parseIpv4(settings.plex.targetHost.trim())?.join(".") ||
    hostFromUrl(settings.downloader.targetHost) ||
    hostFromUrl(settings.plex.targetHost);
  if (target && isPrivateIpv4(target)) {
    const parts = parseIpv4(target)!;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  return "";
}

function buildMagicPacketBase64(mac: string): string {
  const normalized = normalizeMac(mac);
  if (!normalized) throw new Error("MAC address must look like AA:BB:CC:DD:EE:FF");
  const macBytes = normalized.split(":").map((h) => Number.parseInt(h, 16));
  const packet = new Uint8Array(102);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i += 1) {
    packet.set(macBytes, 6 + i * 6);
  }
  let binary = "";
  for (let i = 0; i < packet.length; i += 1) {
    binary += String.fromCharCode(packet[i]!);
  }
  return btoa(binary);
}

async function loadWolSeed(): Promise<Partial<WolSettings>> {
  const modules = import.meta.glob<{
    wolDefaults?: Partial<WolSettings>;
    default?: unknown;
  }>("./credentials.local.ts", { eager: true });
  const mod = modules["./credentials.local.ts"];
  return mod?.wolDefaults ?? {};
}

export async function loadWolSettings(): Promise<WolSettings> {
  const seed = await loadWolSeed();
  const base = normalizeWolSettings({ ...DEFAULT_WOL, ...seed });
  try {
    let { value } = await Preferences.get({ key: WOL_STORAGE_KEY });
    if (!value) {
      const legacy = await Preferences.get({ key: WOL_STORAGE_KEY_LEGACY });
      value = legacy.value;
    }
    if (!value) return base;
    const parsed = JSON.parse(value) as Partial<WolSettings>;
    return normalizeWolSettings({ ...base, ...parsed });
  } catch {
    return base;
  }
}

export async function saveWolSettings(settings: WolSettings): Promise<void> {
  await Preferences.set({
    key: WOL_STORAGE_KEY,
    value: JSON.stringify(settings),
  });
}

async function peekLocalIpv4(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const created = await UdpSocket.create({
      properties: { name: "wol-probe", bufferSize: 256 },
    });
    const ip = created.ipv4 || null;
    try {
      await UdpSocket.close({ socketId: created.socketId });
    } catch {
      // ignore
    }
    return ip;
  } catch {
    return null;
  }
}

/**
 * Prefer subnet match against home CIDR (SSID is flaky/permission-heavy on Android).
 * Connection type (wifi vs cellular) only informs the warning copy.
 */
export async function detectHomeNetwork(
  settings: WolSettings,
  homeBaseUrl = "",
): Promise<HomeNetworkStatus> {
  const homeCidr = resolveHomeCidr(settings, homeBaseUrl);
  let connectionType = "unknown";
  try {
    const status = await Network.getStatus();
    connectionType = status.connected ? status.connectionType : "none";
  } catch {
    connectionType = "unknown";
  }

  const localIp = await peekLocalIpv4();

  if (!homeCidr) {
    return {
      onHomeNetwork: null,
      connectionType,
      localIp,
      homeCidr: "",
      message:
        "Set Home / LAN base URL (or Home network CIDR) so we can detect your LAN. Public remote IPs are not used for this.",
      warnRemote: true,
    };
  }

  if (localIp && ipInCidr(localIp, homeCidr)) {
    return {
      onHomeNetwork: true,
      connectionType,
      localIp,
      homeCidr,
      message: `On home network (${localIp} in ${homeCidr})`,
      warnRemote: false,
    };
  }

  if (connectionType === "cellular") {
    return {
      onHomeNetwork: false,
      connectionType,
      localIp,
      homeCidr,
      message:
        "On cellular — direct WOL only works on home Wi‑Fi / VPN. Try hub relay if Arrs Hub is reachable.",
      warnRemote: true,
    };
  }

  if (localIp) {
    return {
      onHomeNetwork: false,
      connectionType,
      localIp,
      homeCidr,
      message: `Local IP ${localIp} is outside ${homeCidr}. Direct WOL needs the same LAN (or VPN).`,
      warnRemote: true,
    };
  }

  return {
    onHomeNetwork: null,
    connectionType,
    localIp,
    homeCidr,
    message:
      "Could not confirm home LAN. You can still wake; magic packets only work on the same network / VPN.",
    warnRemote: true,
  };
}

export async function sendDirectWakeOnLan(
  settings: WolWakeSettings,
): Promise<WakeResult> {
  if (!Capacitor.isNativePlatform()) {
    return {
      ok: false,
      method: "none",
      message: "Direct WOL needs the Android app (UDP broadcast).",
    };
  }

  const mac = normalizeMac(settings.mac);
  if (!mac) {
    return {
      ok: false,
      method: "none",
      message: "Add a valid MAC address in Settings → Wake-on-LAN.",
    };
  }

  const port = Number(settings.port) || 9;
  const directed =
    settings.broadcastIp.trim() &&
    settings.broadcastIp.trim() !== "255.255.255.255"
      ? settings.broadcastIp.trim()
      : guessBroadcastAddress(settings.targetHost.trim()) || null;
  const targets = [directed, "255.255.255.255"].filter(
    (v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i,
  );

  const buffer = buildMagicPacketBase64(mac);
  let socketId: number | null = null;
  try {
    const created = await UdpSocket.create({
      properties: { name: "wol", bufferSize: 256 },
    });
    socketId = created.socketId;
    await UdpSocket.bind({ socketId, port: 0 });
    await UdpSocket.setBroadcast({ socketId, enabled: true });

    const errors: string[] = [];
    for (const address of targets) {
      try {
        await UdpSocket.send({ socketId, address, port, buffer });
      } catch (err) {
        errors.push(
          `${address}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (errors.length === targets.length) {
      return {
        ok: false,
        method: "direct",
        message: `WOL send failed: ${errors.join("; ")}`,
        mac,
      };
    }

    return {
      ok: true,
      method: "direct",
      message: `Magic packet sent to ${mac} via ${targets.join(", ")}`,
      mac,
      addresses: targets,
    };
  } catch (err) {
    return {
      ok: false,
      method: "direct",
      message: err instanceof Error ? err.message : String(err),
      mac,
    };
  } finally {
    if (socketId != null) {
      try {
        await UdpSocket.close({ socketId });
      } catch {
        // ignore
      }
    }
  }
}

/** Match MAC against configured Port Watch PCs (settings.pcs), not live status map. */
export function matchHubPcIdByMac(
  pcs: Array<{ id?: string; mac?: string }>,
  macRaw: string,
): string | null {
  const mac = normalizeMac(macRaw);
  if (!mac) return null;
  const match = pcs.find((pc) => normalizeMac(pc.mac || "") === mac);
  const id = String(match?.id || "").trim();
  return id || null;
}

async function resolveHubPcId(
  hubBase: string,
  settings: WolWakeSettings,
): Promise<string | null> {
  if (settings.hubPcId.trim()) return settings.hubPcId.trim();
  const mac = normalizeMac(settings.mac);
  if (!mac) return null;
  try {
    const res = await CapacitorHttp.get({
      url: `${hubBase}/api/watchdog/status`,
      headers: mergeHubAuthHeaders({ Accept: "application/json" }),
      connectTimeout: 4000,
      readTimeout: 4000,
    });
    if (isHubAuthFailure(res.status)) return null;
    if (res.status < 200 || res.status >= 400) return null;
    const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    // Prefer configured settings.pcs — live `pcs` is a status map keyed by id.
    const settingsPcs = (data?.settings?.pcs || []) as Array<{
      id?: string;
      mac?: string;
    }>;
    return matchHubPcIdByMac(settingsPcs, mac);
  } catch {
    return null;
  }
}

/** Field-level equality for WOL settings (avoids JSON.stringify churn). */
export function wolSettingsEqual(a: WolSettings, b: WolSettings): boolean {
  const targetEq = (x: WolTarget, y: WolTarget) =>
    x.enabled === y.enabled &&
    x.mac === y.mac &&
    x.targetHost === y.targetHost &&
    x.hubPcId === y.hubPcId;
  return (
    a.enabled === b.enabled &&
    a.broadcastIp === b.broadcastIp &&
    a.port === b.port &&
    a.homeCidr === b.homeCidr &&
    a.hubUrl === b.hubUrl &&
    a.hubPort === b.hubPort &&
    targetEq(a.plex, b.plex) &&
    targetEq(a.downloader, b.downloader)
  );
}

export async function sendHubWakeOnLan(
  settings: WolWakeSettings,
): Promise<WakeResult> {
  const hubBase = buildHubBaseUrl(settings.hubUrl, settings.hubPort);
  if (!hubBase) {
    return {
      ok: false,
      method: "hub",
      message: "No Arrs Hub URL configured for relay.",
    };
  }

  const pcId = await resolveHubPcId(hubBase, settings);
  const mac = normalizeMac(settings.mac);
  if (!pcId && !mac) {
    return {
      ok: false,
      method: "hub",
      message:
        "Hub relay needs a MAC address or a matching PC in Arrs Hub Port Watch.",
    };
  }

  try {
    const res = await CapacitorHttp.post({
      url: `${hubBase}/api/watchdog/wol`,
      headers: mergeHubAuthHeaders({ "Content-Type": "application/json" }),
      data: pcId
        ? { pcId }
        : { mac, host: settings.targetHost.trim() },
      connectTimeout: 6000,
      readTimeout: 6000,
    });
    const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    if (isHubAuthFailure(res.status)) {
      return {
        ok: false,
        method: "hub",
        message: new HubAuthError(res.status).message,
      };
    }
    if (res.status >= 200 && res.status < 300 && data && data.ok !== false) {
      return {
        ok: true,
        method: "hub",
        message:
          data.message ||
          `Hub relay WOL sent${data.mac ? ` to ${data.mac}` : ""}`,
        mac: data.mac,
      };
    }
    return {
      ok: false,
      method: "hub",
      message: data?.error || `Hub WOL failed (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      method: "hub",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function wakePcByTarget(
  settings: WolSettings,
  targetKey: WolTargetKey,
  options?: { preferHub?: boolean },
): Promise<WakeResult> {
  const target = settings[targetKey];
  if (!target.enabled) {
    return {
      ok: false,
      method: "none",
      message: `${wolTargetLabel(targetKey)} wake is disabled in settings.`,
    };
  }
  return wakePc(settingsForTarget(settings, targetKey), options);
}

/**
 * Wake a PC — direct LAN magic packet when home, or hub relay when configured.
 */
export async function wakePc(
  settings: WolWakeSettings,
  options?: { preferHub?: boolean },
): Promise<WakeResult> {
  const preferHub = options?.preferHub === true;

  if (preferHub && settings.hubUrl.trim()) {
    const hub = await sendHubWakeOnLan(settings);
    if (hub.ok) return hub;
    const direct = await sendDirectWakeOnLan(settings);
    if (direct.ok) {
      return {
        ...direct,
        message: `${direct.message} (hub failed: ${hub.message})`,
      };
    }
    return {
      ok: false,
      method: "none",
      message: `Hub: ${hub.message}. Direct: ${direct.message}`,
    };
  }

  const direct = await sendDirectWakeOnLan(settings);
  if (direct.ok) return direct;

  if (settings.hubUrl.trim()) {
    const hub = await sendHubWakeOnLan(settings);
    if (hub.ok) {
      return {
        ...hub,
        message: `${hub.message} (direct failed: ${direct.message})`,
      };
    }
    return {
      ok: false,
      method: "none",
      message: `Direct: ${direct.message}. Hub: ${hub.message}`,
    };
  }

  return direct;
}
