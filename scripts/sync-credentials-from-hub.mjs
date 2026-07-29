/**
 * Pull Sonarr/Radarr API keys from Arrs Hub local data into credentials.local.ts
 * (gitignored). Run: node scripts/sync-credentials-from-hub.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubDataCandidates = [
  path.join(root, "..", "Arrs-Hub", "data", "sync-settings.json"),
  path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "Arrs-Hub",
    "data",
    "sync-settings.json",
  ),
  "G:\\My Drive\\Python Scripts\\Arrs-Hub\\data\\sync-settings.json",
];

const workoutCandidates = hubDataCandidates.map((p) =>
  p.replace(/sync-settings\.json$/, "workout-settings.json"),
);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

let sync = null;
let syncPath = "";
for (const candidate of hubDataCandidates) {
  sync = readJson(candidate);
  if (sync) {
    syncPath = candidate;
    break;
  }
}

if (!sync) {
  console.error("Could not find Arrs Hub data/sync-settings.json");
  process.exit(1);
}

/** @type {Record<string, { url?: string, apiKey?: string, username?: string, password?: string }>} */
const seed = {};

if (sync.sonarr?.apiKey) {
  seed.sonarr = {
    url: sync.sonarr.baseUrl || "http://67.84.101.14:8989",
    apiKey: sync.sonarr.apiKey,
  };
}
if (sync.radarr?.apiKey) {
  seed.radarr = {
    url: sync.radarr.baseUrl || "http://67.84.101.14:7878",
    apiKey: sync.radarr.apiKey,
  };
}

for (const candidate of workoutCandidates) {
  const workout = readJson(candidate);
  if (workout?.plexToken) {
    seed.plex = {
      url: String(workout.plexBaseUrl || workout.plexUrl || "http://67.84.101.14:32400")
        .trim()
        .replace(/\/web\/?$/, ""),
      apiKey: workout.plexToken,
    };
    break;
  }
}

const outPath = path.join(root, "src", "credentials.local.ts");
const body = `/**
 * Auto-generated from Arrs Hub — do not commit.
 * Source: ${syncPath.replace(/\\\\/g, "/")}
 * Re-run: node scripts/sync-credentials-from-hub.mjs
 */
import type { CredentialSeed } from "./services";

const seed: CredentialSeed = ${JSON.stringify(seed, null, 2)};

export default seed;
`;

fs.writeFileSync(outPath, body, "utf8");
console.log("Wrote", outPath);
console.log("Seeded:", Object.keys(seed).join(", ") || "(none)");
