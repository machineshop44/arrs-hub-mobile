/**
 * Pull Sonarr/Radarr API keys (and optional WOL MAC) from Arrs Hub local data,
 * plus Ytarr api_key from ytarr config.yaml, into credentials.local.ts (gitignored).
 * Run: node scripts/sync-credentials-from-hub.mjs
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

const watchdogCandidates = hubDataCandidates.map((p) =>
  p.replace(/sync-settings\.json$/, "watchdog-settings.json"),
);

const ytarrConfigCandidates = [
  path.join(root, "..", "yt arr app", "config.yaml"),
  path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "yt arr app",
    "config.yaml",
  ),
  path.join(root, "..", "ytarr", "config.yaml"),
];

const REMOTE_HOST = "http://67.84.101.14";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/** Best-effort YAML scalar extract (no full parser). */
function yamlScalar(text, key) {
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m");
  const m = text.match(re);
  if (!m) return "";
  return m[1].replace(/^["']|["']$/g, "").trim();
}

function loadExistingSeed(outPath) {
  const raw = readText(outPath);
  if (!raw) return {};
  const m = raw.match(/const seed: CredentialSeed = (\{[\s\S]*?\});\s*\n/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
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

const outPath = path.join(root, "src", "credentials.local.ts");

/** @type {Record<string, { url?: string, apiKey?: string, username?: string, password?: string }>} */
const seed = { ...loadExistingSeed(outPath) };

if (sync.sonarr?.apiKey) {
  seed.sonarr = {
    url: sync.sonarr.baseUrl || `${REMOTE_HOST}:8989`,
    apiKey: sync.sonarr.apiKey,
  };
}
if (sync.radarr?.apiKey) {
  seed.radarr = {
    url: sync.radarr.baseUrl || `${REMOTE_HOST}:7878`,
    apiKey: sync.radarr.apiKey,
  };
}
if (sync.bazarr?.apiKey) {
  seed.bazarr = {
    url: sync.bazarr.baseUrl || `${REMOTE_HOST}:6767`,
    apiKey: sync.bazarr.apiKey,
  };
}
if (sync.ytarr?.apiKey || sync.ytarr?.api_key) {
  seed.ytarr = {
    url: sync.ytarr.baseUrl || sync.ytarr.url || `${REMOTE_HOST}:8199`,
    apiKey: sync.ytarr.apiKey || sync.ytarr.api_key,
  };
}

// FlareSolverr has no API key — seed remote URL so Settings/Home match hub.
if (!seed.flaresolverr?.url) {
  seed.flaresolverr = { url: `${REMOTE_HOST}:8191` };
}

for (const candidate of workoutCandidates) {
  const workout = readJson(candidate);
  if (workout?.plexToken) {
    seed.plex = {
      url: String(workout.plexBaseUrl || workout.plexUrl || `${REMOTE_HOST}:32400`)
        .trim()
        .replace(/\/web\/?$/, ""),
      apiKey: workout.plexToken,
    };
    // Workouts module talks to Arrs Hub (token stays server-side). Seed hub URL only.
    if (!seed.workouts?.url) {
      seed.workouts = { url: `${REMOTE_HOST}:3000` };
    }
    break;
  }
}

let ytarrConfigPath = "";
for (const candidate of ytarrConfigCandidates) {
  const text = readText(candidate);
  if (!text) continue;
  const apiKey = yamlScalar(text, "api_key");
  if (!apiKey) continue;
  const port = yamlScalar(text, "port") || "8199";
  const host = yamlScalar(text, "host");
  // Prefer WAN hub URL for tablet; local loopback is useless on device.
  const url =
    host && host !== "127.0.0.1" && host !== "localhost"
      ? `http://${host}:${port}`
      : `${REMOTE_HOST}:${port}`;
  seed.ytarr = { url, apiKey };
  ytarrConfigPath = candidate;
  console.log("Ytarr API key from", candidate, `(${apiKey.length} chars)`);
  break;
}

if (!ytarrConfigPath && !seed.ytarr?.apiKey) {
  console.log("Ytarr: no api_key found in config.yaml (Settings field still works)");
}

/** @type {Record<string, string | boolean | number>} */
const wolDefaults = {};
for (const candidate of watchdogCandidates) {
  const watchdog = readJson(candidate);
  const pcs = Array.isArray(watchdog?.pcs) ? watchdog.pcs : [];
  const pc = pcs.find((item) => String(item?.mac || "").trim());
  if (pc) {
    wolDefaults.enabled = true;
    wolDefaults.mac = String(pc.mac).trim();
    if (pc.host) wolDefaults.targetHost = String(pc.host).trim();
    if (pc.id) wolDefaults.hubPcId = String(pc.id).trim();
    console.log("WOL seed from", candidate, "→", wolDefaults.mac);
    break;
  }
}

const wolBlock =
  Object.keys(wolDefaults).length > 0
    ? `
import type { WolSettings } from "./wol";

export const wolDefaults: Partial<WolSettings> = ${JSON.stringify(wolDefaults, null, 2)};
`
    : `
import type { WolSettings } from "./wol";

export const wolDefaults: Partial<WolSettings> = {};
`;

const sources = [
  syncPath.replace(/\\/g, "/"),
  ytarrConfigPath ? ytarrConfigPath.replace(/\\/g, "/") : null,
]
  .filter(Boolean)
  .join(" + ");

const body = `/**
 * Auto-generated from Arrs Hub — do not commit.
 * Source: ${sources}
 * Re-run: node scripts/sync-credentials-from-hub.mjs
 */
import type { CredentialSeed } from "./services";
${wolBlock}
const seed: CredentialSeed = ${JSON.stringify(seed, null, 2)};

export default seed;
`;

fs.writeFileSync(outPath, body, "utf8");
console.log("Wrote", outPath);
console.log(
  "Seeded:",
  Object.keys(seed)
    .map((id) => `${id}${seed[id]?.apiKey ? "" : " (no key)"}`)
    .join(", ") || "(none)",
);
if (Object.keys(wolDefaults).length) {
  console.log("WOL:", wolDefaults.mac || "(none)");
} else {
  console.log("WOL: no PC MAC in watchdog-settings.json yet");
}
