import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Live reload: set CAPACITOR_LIVE_RELOAD_URL (e.g. http://localhost:5174)
 * before `cap sync`. With USB + `adb reverse tcp:5174 tcp:5174`, the tablet
 * loads Vite and hot-reloads — Andrew never needs to run sync.
 */
const liveUrl = process.env.CAPACITOR_LIVE_RELOAD_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.arrshub.status.tester",
  appName: "Arrs Hub Mobile Tester",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: true,
    ...(liveUrl ? { url: liveUrl } : {}),
  },
  android: {
    allowMixedContent: true,
    // Android 15+ draws edge-to-edge; inset the WebView so UI sits below
    // the status bar / above the nav bar (same idea as Ava's statusBarsPadding).
    adjustMarginsForEdgeToEdge: "force",
    backgroundColor: "#12141c",
  },
};

export default config;
