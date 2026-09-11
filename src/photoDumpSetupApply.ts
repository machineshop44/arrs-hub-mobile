/**
 * Decide how a Hub photo-dump setup QR should update stored URLs.
 * LAN (RFC1918) must never become the canonical remote Hub URL.
 */

import { hostFromUrlOrHost, isPrivateIpv4 } from "./pathing";
import { normalizeHubPort, splitHubHostAndPort } from "./wol";

export type PhotoDumpSetupApplyPlan = {
  /** Update pathing.homeBaseUrl when set. */
  homeBaseUrl?: string;
  /** Update wol.hubUrl when set. */
  wolHubUrl?: string;
  /** Update wol.hubPort when set. */
  wolHubPort?: number;
  /**
   * Photo-dump service.url:
   * - string → set
   * - "" → clear (fall back to wol.hubUrl)
   * - undefined → leave unchanged
   */
  photoDumpUrl?: string;
};

/** True when host looks like a public/WAN target (non-RFC1918). */
export function isWanHubUrl(raw: string): boolean {
  const host = hostFromUrlOrHost(raw);
  if (!host) return false;
  return !isPrivateIpv4(host);
}

/** True when host is RFC1918 private IPv4. */
export function isLanHubUrl(raw: string): boolean {
  const host = hostFromUrlOrHost(raw);
  return !!host && isPrivateIpv4(host);
}

/**
 * Prefer wol.hubUrl as the remote canonical when service.url is a LAN address
 * but wol already holds a public Hub URL (defense after a bad LAN QR).
 */
export function preferHubRemoteUrl(
  serviceUrl: string,
  wolHubUrl: string,
): string {
  const svc = String(serviceUrl || "").trim();
  const wol = String(wolHubUrl || "").trim();
  if (isLanHubUrl(svc) && isWanHubUrl(wol)) return wol;
  if (!svc && wol) return wol;
  return svc;
}

/**
 * Plan settings updates from a scanned photo-dump setup URL.
 * Always apply the API key separately; this only covers host/URL fields.
 */
export function planPhotoDumpSetupApply(input: {
  scannedUrl: string;
  existingWolHubUrl: string;
  existingPhotoDumpUrl: string;
}): PhotoDumpSetupApplyPlan {
  const { host, port } = splitHubHostAndPort(input.scannedUrl);
  const hubHost = (host || input.scannedUrl.trim()).trim();
  if (!hubHost) {
    return port != null ? { wolHubPort: normalizeHubPort(port) } : {};
  }

  const scannedHost = hostFromUrlOrHost(hubHost);
  const scannedLan = !!(scannedHost && isPrivateIpv4(scannedHost));
  const portUpdate =
    port != null ? { wolHubPort: normalizeHubPort(port) } : {};

  if (scannedLan) {
    const lanBase = `http://${scannedHost}`;
    const pdIsWan = isWanHubUrl(input.existingPhotoDumpUrl);

    // Never write LAN into wol.hubUrl. Keep existing WAN photo-dump URL;
    // otherwise clear so pathing falls back to wol.hubUrl.
    return {
      homeBaseUrl: lanBase,
      ...portUpdate,
      ...(pdIsWan ? {} : { photoDumpUrl: "" }),
    };
  }

  // Public / WAN (public IP or hostname): canonical remote Hub.
  return {
    wolHubUrl: hubHost,
    ...portUpdate,
    photoDumpUrl: hubHost,
  };
}
