/**
 * Copy to credentials.local.ts and fill in keys for device testing.
 * credentials.local.ts is gitignored.
 */
import type { CredentialSeed } from "./services";

const seed: CredentialSeed = {
  // sonarr: { apiKey: "…" },
  // radarr: { apiKey: "…" },
  // qbittorrent: { username: "admin", password: "…" },
};

export default seed;
