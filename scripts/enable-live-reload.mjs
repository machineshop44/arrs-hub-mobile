import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --use-system-ca`.trim();
process.env.CAPACITOR_LIVE_RELOAD_URL = "http://localhost:5174";

function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    path.join(
      process.env.LOCALAPPDATA || "",
      "Android",
      "Sdk",
      "platform-tools",
      "adb.exe",
    ),
    path.join(
      process.env.USERPROFILE || "",
      "AppData",
      "Local",
      "Android",
      "Sdk",
      "platform-tools",
      "adb.exe",
    ),
    "C:\\Android\\Sdk\\platform-tools\\adb.exe",
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "adb" || fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const adb = findAdb();
if (adb) {
  const reversed = spawnSync(adb, ["reverse", "tcp:5174", "tcp:5174"], {
    encoding: "utf8",
  });
  if (reversed.status === 0) {
    console.log("adb reverse: tablet localhost:5174 -> PC Vite");
  } else {
    console.warn("adb reverse failed:", (reversed.stderr || "").trim());
  }
} else {
  console.warn("adb not found — plug tablet in USB with debugging on.");
}

const sync = spawnSync("npx", ["cap", "sync", "android"], {
  encoding: "utf8",
  shell: true,
  env: process.env,
  stdio: "inherit",
});
process.exit(sync.status ?? 1);
