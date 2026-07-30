/**
 * Publish phone-installable APKs into Google Drive with stable filenames so
 * Andrew can install remotely (Drive app on Pixel) instead of Quick Share.
 *
 * Targets (first match wins for local sync folder):
 *   G:\My Drive\Phone APKs\
 *   ~/Google Drive/Phone APKs/
 *   DRIVE_APK_DIR env
 *
 * Stable names (overwrite in place → phone bookmark keeps working):
 *   ArrsHubStatus.apk
 *   AvaBedtime.apk
 *
 * Optional API upload (cloud agents): credentials.drive.json
 *   { "folderId": "...", "serviceAccount": { ... } }
 * or GOOGLE_DRIVE_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON
 *
 * Usage:
 *   node scripts/publish-phone-apks.mjs              # Arrs Hub from this repo
 *   node scripts/publish-phone-apks.mjs --all        # Arrs + Ava if found
 *   node scripts/publish-phone-apks.mjs --arrs path/to.apk
 *   node scripts/publish-phone-apks.mjs --ava path/to.apk
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STABLE = {
  arrs: "ArrsHubStatus.apk",
  ava: "AvaBedtime.apk",
};

const LOCAL_DRIVE_CANDIDATES = [
  process.env.DRIVE_APK_DIR,
  "G:\\My Drive\\Phone APKs",
  path.join(process.env.USERPROFILE || "", "Google Drive", "Phone APKs"),
  path.join(process.env.HOME || "", "Google Drive", "Phone APKs"),
  "/mnt/g/My Drive/Phone APKs",
].filter(Boolean);

const AVA_ROOT_CANDIDATES = [
  process.env.AVA_BEDTIME_ROOT,
  path.join(root, "..", "Ava-Bedtime"),
  path.join(root, "..", "ava-bedtime"),
  path.join(root, "..", "Ava Bedtime"),
  "G:\\My Drive\\Python Scripts\\Ava-Bedtime",
  "G:\\My Drive\\Python Scripts\\Ava Bedtime",
  path.join(process.env.USERPROFILE || "", "Desktop", "Ava-Bedtime"),
].filter(Boolean);

function parseArgs(argv) {
  const out = { all: false, arrs: null, ava: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--arrs") out.arrs = argv[++i];
    else if (a === "--ava") out.ava = argv[++i];
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveLocalDriveDir() {
  for (const candidate of LOCAL_DRIVE_CANDIDATES) {
    const parent = path.dirname(candidate);
    // Prefer an existing Drive root; create Phone APKs under it when possible.
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(parent) && /My Drive|Google Drive/i.test(parent)) {
      ensureDir(candidate);
      return candidate;
    }
  }
  return null;
}

function loadDriveApiConfig() {
  const localPath = path.join(root, "credentials.drive.json");
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf8"));
  }
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (folderId && saRaw) {
    return { folderId, serviceAccount: JSON.parse(saRaw) };
  }
  return null;
}

function copyToLocalDrive(apkPath, stableName, driveDir) {
  ensureDir(driveDir);
  const dest = path.join(driveDir, stableName);
  fs.copyFileSync(apkPath, dest);
  // Touch a tiny sidecar so Drive clients notice overwrites reliably.
  fs.writeFileSync(
    path.join(driveDir, `${stableName}.updated.txt`),
    `Updated ${new Date().toISOString()}\nSource: ${apkPath}\n`,
    "utf8",
  );
  return dest;
}

async function getAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const claim = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(serviceAccount.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive token failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function findDriveFileId(token, folderId, name) {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.files?.[0]?.id || null;
}

async function uploadViaDriveApi(apkPath, stableName, config) {
  const token = await getAccessToken(config.serviceAccount);
  const existingId = await findDriveFileId(
    token,
    config.folderId,
    stableName,
  );
  const bytes = fs.readFileSync(apkPath);
  const metadata = {
    name: stableName,
    parents: existingId ? undefined : [config.folderId],
  };

  const boundary = "arrs_apk_" + Date.now();
  const bodyStart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v !== undefined),
    ),
  )}\r\n--${boundary}\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n`;
  const bodyEnd = `\r\n--${boundary}--`;
  const payload = Buffer.concat([
    Buffer.from(bodyStart, "utf8"),
    bytes,
    Buffer.from(bodyEnd, "utf8"),
  ]);

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const method = existingId ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { id: json.id, name: json.name, updated: Boolean(existingId) };
}

function defaultArrsApk() {
  const built = path.join(
    root,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk",
  );
  const releaseCopy = path.join(
    root,
    "releases",
    "ArrsHubStatus-1.0.2-universal-debug.apk",
  );
  if (fs.existsSync(built)) return built;
  if (fs.existsSync(releaseCopy)) return releaseCopy;
  return null;
}

function findAvaApk() {
  for (const avaRoot of AVA_ROOT_CANDIDATES) {
    if (!avaRoot || !fs.existsSync(avaRoot)) continue;
    const candidates = [
      path.join(
        avaRoot,
        "android",
        "app",
        "build",
        "outputs",
        "apk",
        "debug",
        "app-debug.apk",
      ),
      path.join(avaRoot, "releases", "AvaBedtime.apk"),
      path.join(avaRoot, "releases", "AvaBedtime-universal-debug.apk"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { apk: c, root: avaRoot };
    }
    // Any releases/*.apk
    const relDir = path.join(avaRoot, "releases");
    if (fs.existsSync(relDir)) {
      const hit = fs
        .readdirSync(relDir)
        .filter((f) => f.toLowerCase().endsWith(".apk"))
        .map((f) => path.join(relDir, f))[0];
      if (hit) return { apk: hit, root: avaRoot };
    }
  }
  return null;
}

async function publishOne(label, apkPath, stableName, driveDir, apiConfig) {
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.error(`[${label}] APK missing: ${apkPath || "(none)"}`);
    return false;
  }
  const sizeMb = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(1);
  console.log(`[${label}] ${apkPath} (${sizeMb} MB) → ${stableName}`);

  let ok = false;
  if (driveDir) {
    const dest = copyToLocalDrive(apkPath, stableName, driveDir);
    console.log(`[${label}] Copied to Drive folder: ${dest}`);
    ok = true;
  }
  if (apiConfig?.folderId && apiConfig?.serviceAccount) {
    const result = await uploadViaDriveApi(apkPath, stableName, apiConfig);
    console.log(
      `[${label}] Drive API ${result.updated ? "updated" : "created"} file id=${result.id}`,
    );
    ok = true;
  }
  if (!ok) {
    console.error(
      `[${label}] No Google Drive target. Create "Phone APKs" under My Drive (Desktop sync), or add credentials.drive.json (see drive.publish.example.json).`,
    );
  }
  return ok;
}

const args = parseArgs(process.argv.slice(2));
const driveDir = resolveLocalDriveDir();
const apiConfig = loadDriveApiConfig();

if (driveDir) console.log("Local Drive folder:", driveDir);
else console.log("Local Drive folder: (not found)");
if (apiConfig?.folderId) console.log("Drive API folder:", apiConfig.folderId);
else console.log("Drive API: (not configured)");

const jobs = [];
const wantArrs = Boolean(args.arrs) || !args.ava || args.all;
const wantAva = Boolean(args.ava) || args.all;

if (wantArrs) {
  jobs.push({
    label: "Arrs Hub Status",
    apk: args.arrs || defaultArrsApk(),
    name: STABLE.arrs,
  });
}
if (wantAva) {
  if (args.ava) {
    jobs.push({ label: "Ava Bedtime", apk: args.ava, name: STABLE.ava });
  } else {
    const found = findAvaApk();
    if (found) {
      console.log("Found Ava project at", found.root);
      jobs.push({ label: "Ava Bedtime", apk: found.apk, name: STABLE.ava });
    } else {
      console.warn(
        "Ava Bedtime APK not found. Pass --ava path/to.apk or set AVA_BEDTIME_ROOT. Looked in:",
      );
      for (const c of AVA_ROOT_CANDIDATES) console.warn(" -", c);
    }
  }
}

let failed = false;
for (const job of jobs) {
  const ok = await publishOne(
    job.label,
    job.apk,
    job.name,
    driveDir,
    apiConfig,
  );
  if (!ok) failed = true;
}

if (!jobs.length) {
  console.error("Nothing to publish.");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
