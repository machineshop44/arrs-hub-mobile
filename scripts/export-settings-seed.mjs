/**
 * Build ArrsHubStatus-settings.json from credentials.local.ts for Drive / Pixel.
 * Does not write secrets into git.
 *
 * Usage: node scripts/export-settings-seed.mjs [outPath]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REMOTE = "http://67.84.101.14";
const DEFAULTS = [
  ["sonarr", `${REMOTE}:8989`, true],
  ["radarr", `${REMOTE}:7878`, true],
  ["lidarr", `${REMOTE}:8686`, true],
  ["readarr", `${REMOTE}:8787`, true],
  ["prowlarr", `${REMOTE}:9696`, true],
  ["flaresolverr", `${REMOTE}:8191`, true],
  ["bazarr", `${REMOTE}:6767`, true],
  ["qbittorrent", `${REMOTE}:8079`, true],
  ["sabnzbd", `${REMOTE}:6789/sabnzbd/`, true],
  ["ombi", `${REMOTE}:5000`, true],
  ["tautulli", `${REMOTE}:8181`, true],
  ["fileflows", `${REMOTE}:19200`, true],
  ["fileflows-node", "companion://local", true],
  ["plex", `${REMOTE}:32400`, true],
  ["calibre", `${REMOTE}:8080`, false],
  ["overseerr", `${REMOTE}:5055`, false],
  ["whisparr", `${REMOTE}:6969`, false],
  ["ytarr", `${REMOTE}:8199`, true],
  ["workouts", `${REMOTE}`, true],
];

/** Must match PERSISTED_STORAGE_KEYS in src/settingsTransfer.ts */
const STORAGE_KEYS = {
  services: "arrs-mobile-services-v3",
  moduleOrder: "arrs-mobile-module-order-v1",
  wol: "arrs-mobile-wol-v1",
  pathing: "arrs-mobile-pathing-v1",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath =
  process.argv[2] ||
  path.join("G:", "My Drive", "apks", "ArrsHubStatus-settings.json");

const localPath = path.join(root, "src", "credentials.local.ts");
if (!fs.existsSync(localPath)) {
  console.error("Missing src/credentials.local.ts — run npm run sync:keys first");
  process.exit(1);
}

const raw = fs.readFileSync(localPath, "utf8");
const seedMatch = raw.match(/const seed: CredentialSeed = (\{[\s\S]*?\});\s*\n/);
if (!seedMatch) {
  console.error("Could not parse seed from credentials.local.ts");
  process.exit(1);
}
const seed = JSON.parse(seedMatch[1]);

let wol = {
  enabled: false,
  mac: "",
  targetHost: "",
  broadcastIp: "255.255.255.255",
  port: 9,
  homeCidr: "",
  hubUrl: "",
  hubPort: 3000,
  hubPcId: "",
};
const wolMatch = raw.match(
  /export const wolDefaults: Partial<WolSettings> = (\{[\s\S]*?\});/,
);
if (wolMatch) {
  try {
    wol = { ...wol, ...JSON.parse(wolMatch[1]) };
  } catch {
    /* keep defaults */
  }
}

let pathing = { homeBaseUrl: "" };
const pathMatch = raw.match(
  /export const pathingDefaults: Partial<PathSettings> = (\{[\s\S]*?\});/,
);
if (pathMatch) {
  try {
    pathing = { ...pathing, ...JSON.parse(pathMatch[1]) };
  } catch {
    /* keep defaults */
  }
}

const services = DEFAULTS.map(([id, defaultUrl, enabled]) => {
  const extra = seed[id] || {};
  return {
    id,
    url: String(extra.url || defaultUrl).trim(),
    apiKey: String(extra.apiKey || "").trim(),
    username: String(extra.username || "").trim(),
    password: String(extra.password || "").trim(),
    enabled: Boolean(enabled),
  };
});

const bundle = {
  kind: "arrs-hub-status-settings",
  v: 1,
  exportedAt: new Date().toISOString(),
  storageKeys: STORAGE_KEYS,
  services,
  moduleOrder: [],
  wol,
  pathing,
};

const json = `${JSON.stringify(bundle, null, 2)}\n`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, json, "utf8");

// Local mirror under apks/ (gitignored)
const localOut = path.join(root, "apks", "ArrsHubStatus-settings.json");
fs.mkdirSync(path.dirname(localOut), { recursive: true });
fs.writeFileSync(localOut, json, "utf8");

const wolFilled = Boolean(
  wol.enabled ||
    wol.hubUrl ||
    wol.homeCidr ||
    wol.plex?.mac ||
    wol.downloader?.mac ||
    wol.plex?.targetHost ||
    wol.downloader?.targetHost,
);

console.log("Wrote", outPath);
console.log("Local", localOut);
console.log(
  "With API keys:",
  services.filter((s) => s.apiKey).map((s) => s.id).join(", ") || "(none)",
);
console.log(
  "WOL fields:",
  wolFilled
    ? `enabled=${wol.enabled} plex=${wol.plex?.mac || "(empty)"} dl=${wol.downloader?.mac || "(empty)"} hub=${wol.hubUrl || "(empty)"}:${wol.hubPort || 3000}`
    : "present but empty (not configured on this seed)",
);
console.log("storageKeys:", Object.values(STORAGE_KEYS).join(", "));
console.log("JSON chars:", json.length);
