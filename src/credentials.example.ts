/**
 * Copy to credentials.local.ts and fill in keys for device testing.
 * credentials.local.ts is gitignored.
 */
import type { PathSettings } from "./pathing";
import type { CredentialSeed } from "./services";
import type { WolSettings } from "./wol";

const seed: CredentialSeed = {
  // sonarr: { apiKey: "…" },
  // radarr: { apiKey: "…" },
  // qbittorrent: { username: "admin", password: "…" },
  // ytarr: { url: "http://67.84.101.14:8199", apiKey: "…" },
  // flaresolverr: { url: "http://67.84.101.14:8191" },
  // workouts: { url: "http://192.168.1.10" }, // Arrs Hub host; port via Settings → Network
};

/** Optional WOL defaults (MAC is fine to keep locally; not a secret). */
export const wolDefaults: Partial<WolSettings> = {
  // enabled: true,
  // mac: "AA:BB:CC:DD:EE:FF",
  // targetHost: "192.168.1.10",
  // homeCidr: "192.168.1.0/24",
  // hubUrl: "http://192.168.1.10",
  // hubPort: 3000,
};

/** Optional dual-path defaults (LAN host for home Wi‑Fi; path is auto from IP/CIDR). */
export const pathingDefaults: Partial<PathSettings> = {
  // homeBaseUrl: "http://192.168.1.50",
};

export default seed;
