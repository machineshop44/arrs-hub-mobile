import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";

/**
 * True while the app is in the foreground. Capacitor keeps the WebView (and
 * its timers) running in the background, so pollers must gate on this.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const onVisibility = () => setActive(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    let remove: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => setActive(isActive)).then(
        (handle) => {
          remove = () => void handle.remove();
        },
      );
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      remove?.();
    };
  }, []);

  return active;
}

/**
 * setInterval that only runs while the app is foregrounded. Fires once
 * immediately when the app comes back if `runOnResume` (default true).
 */
export function useActiveInterval(
  callback: () => void,
  ms: number | null,
  opts: { runOnResume?: boolean } = {},
): void {
  const active = useAppActive();
  const saved = useRef(callback);
  saved.current = callback;
  const wasActive = useRef(active);
  const runOnResume = opts.runOnResume !== false;

  useEffect(() => {
    const resumed = active && !wasActive.current;
    wasActive.current = active;
    if (!active || ms == null) return;
    if (resumed && runOnResume) saved.current();
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [active, ms, runOnResume]);
}
