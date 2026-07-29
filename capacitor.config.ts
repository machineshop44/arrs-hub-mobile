import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Live reload: set CAPACITOR_LIVE_RELOAD_URL (e.g. http://localhost:5174)
 * before `cap sync`. With USB + `adb reverse tcp:5174 tcp:5174`, the tablet
 * loads Vite and hot-reloads — Andrew never needs to run sync.
 */
const liveUrl = process.env.CAPACITOR_LIVE_RELOAD_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.arrshub.status",
  appName: "Arrs Hub Status",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: true,
    ...(liveUrl ? { url: liveUrl } : {}),
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
