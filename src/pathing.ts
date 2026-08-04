import { Preferences } from "@capacitor/preferences";

/** Capacitor Preferences key for home/LAN pathing. */
export const PATHING_STORAGE_KEY = "arrs-mobile-pathing-v1";

/** Effective path after Auto detection or a forced preference. */
export type ConnectionMode = "home" | "remote";
/** Auto detects LAN vs away; home/remote force a mode (mirrors Arrs Hub). */
export type ConnectionPreference = "auto" | ConnectionMode;

export type PathSettings = {
  /**
   * LAN host (or full base without per-service port), e.g. http://192.168.1.50
   * When on the home network, service remote URLs swap to this host and keep their port/path.
   */
  homeBaseUrl: string;
  /** Auto / Home / Remote — same spirit as Arrs Hub `connectionPreference`. */
  connectionPreference: ConnectionPreference;
};

export const DEFAULT_PATHING: PathSettings = {
  homeBaseUrl: "",
  connectionPreference: "auto",
};

export function normalizeConnectionPreference(
  raw: unknown,
): ConnectionPreference {
  if (raw === "home" || raw === "remote" || raw === "auto") return raw;
  return DEFAULT_PATHING.connectionPreference;
}

/** Resolve Auto → home|remote from LAN detection; forced prefs win. */
export function resolveConnectionMode(
  preference: ConnectionPreference,
  onHomeNetwork: boolean | null,
): ConnectionMode {
  if (preference === "home") return "home";
  if (preference === "remote") return "remote";
  return onHomeNetwork === true ? "home" : "remote";
}

/** Chip value: Auto when preference is Auto; else LAN / Remote for forced mode. */
export function pathChipLabel(
  preference: ConnectionPreference,
): "Auto" | "LAN" | "Remote" {
  if (preference === "auto") return "Auto";
  if (preference === "home") return "LAN";
  return "Remote";
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

/** RFC1918 private IPv4 (typical home LAN). */
export function isPrivateIpv4(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  return false;
}

export function hostFromUrlOrHost(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (parseIpv4(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return u.hostname || null;
  } catch {
    return null;
  }
}

/** Derive /24 CIDR from a LAN host URL/IP; null if not a private IPv4. */
export function cidrFromHomeBase(homeBaseUrl: string): string | null {
  const host = hostFromUrlOrHost(homeBaseUrl);
  if (!host) return null;
  const parts = parseIpv4(host);
  if (!parts || !isPrivateIpv4(host)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * When effective mode is home and a home base is set, swap the remote URL's host
 * to the LAN host while keeping the service port and path.
 */
export function resolveServiceUrl(
  remoteUrl: string,
  homeBaseUrl: string,
  onHomeNetwork: boolean | null,
  preference: ConnectionPreference = "auto",
): string {
  const remote = String(remoteUrl || "").trim();
  if (!remote) return remote;
  const mode = resolveConnectionMode(preference, onHomeNetwork);
  if (mode !== "home") return remote;
  const homeHost = hostFromUrlOrHost(homeBaseUrl);
  if (!homeHost) return remote;

  try {
    const u = new URL(remote.includes("://") ? remote : `http://${remote}`);
    u.hostname = homeHost;
    // Keep remote port / path / search (home base is host-only for services).
    let out = u.toString();
    // new URL("http://h:8989") → "http://h:8989/" — strip trailing slash if remote had none
    if (!remote.endsWith("/") && out.endsWith("/") && u.pathname === "/") {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    return remote;
  }
}

export async function loadPathSettings(): Promise<PathSettings> {
  const modules = import.meta.glob<{
    pathingDefaults?: Partial<PathSettings>;
  }>("./credentials.local.ts", { eager: true });
  const seed = modules["./credentials.local.ts"]?.pathingDefaults ?? {};
  const base: PathSettings = {
    ...DEFAULT_PATHING,
    ...seed,
    connectionPreference: normalizeConnectionPreference(
      seed.connectionPreference ?? DEFAULT_PATHING.connectionPreference,
    ),
  };
  try {
    const { value } = await Preferences.get({ key: PATHING_STORAGE_KEY });
    if (!value) return base;
    const parsed = JSON.parse(value) as Partial<PathSettings>;
    return {
      homeBaseUrl:
        (typeof parsed.homeBaseUrl === "string" &&
          parsed.homeBaseUrl.trim()) ||
        base.homeBaseUrl,
      connectionPreference: normalizeConnectionPreference(
        parsed.connectionPreference ?? base.connectionPreference,
      ),
    };
  } catch {
    return base;
  }
}

export async function savePathSettings(settings: PathSettings): Promise<void> {
  await Preferences.set({
    key: PATHING_STORAGE_KEY,
    value: JSON.stringify({
      homeBaseUrl: settings.homeBaseUrl,
      connectionPreference: normalizeConnectionPreference(
        settings.connectionPreference,
      ),
    }),
  });
}
