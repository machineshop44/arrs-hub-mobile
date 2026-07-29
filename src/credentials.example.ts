/**
 * Copy to credentials.local.ts and fill in keys for device testing.
 * credentials.local.ts is gitignored.
 */
import type { CredentialSeed } from "./services";
import type { WolSettings } from "./wol";

const seed: CredentialSeed = {
  // sonarr: { apiKey: "…" },
  // radarr: { apiKey: "…" },
  // qbittorrent: { username: "admin", password: "…" },
};

/** Optional WOL defaults (MAC is fine to keep locally; not a secret). */
export const wolDefaults: Partial<WolSettings> = {
  // enabled: true,
  // mac: "AA:BB:CC:DD:EE:FF",
  // targetHost: "192.168.1.10",
  // homeCidr: "192.168.1.0/24",
  // hubUrl: "http://192.168.1.10:3000",
};

export default seed;
