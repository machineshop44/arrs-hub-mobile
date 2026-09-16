/**
 * Keep the screen awake during long Photo Dump uploads (and similar).
 * Uses the Screen Wake Lock API when available in the Capacitor WebView.
 */

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

let sentinel: WakeLockSentinelLike | null = null;
let wantWake = false;
let visibilityHooked = false;

async function requestLock(): Promise<void> {
  if (!wantWake) return;
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
  };
  if (!nav.wakeLock?.request) return;
  try {
    if (sentinel && !sentinel.released) return;
    sentinel = await nav.wakeLock.request("screen");
    sentinel.addEventListener?.("release", () => {
      sentinel = null;
    });
  } catch (err) {
    console.warn(
      "[wakeLock] Could not keep screen on:",
      err instanceof Error ? err.message : err,
    );
    sentinel = null;
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible" && wantWake) {
    void requestLock();
  }
}

function ensureVisibilityHook(): void {
  if (visibilityHooked || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityHooked = true;
}

/** Hold a screen wake lock until {@link releaseScreenWakeLock}. */
export async function acquireScreenWakeLock(): Promise<void> {
  wantWake = true;
  ensureVisibilityHook();
  await requestLock();
}

/** Release any held wake lock. */
export async function releaseScreenWakeLock(): Promise<void> {
  wantWake = false;
  const held = sentinel;
  sentinel = null;
  if (!held || held.released) return;
  try {
    await held.release();
  } catch {
    // ignore
  }
}
