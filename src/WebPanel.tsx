import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  BackgroundColor,
  InAppBrowser,
  ToolBarType,
} from "@capgo/inappbrowser";
import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";

interface WebPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

/**
 * Web UIs (Ombi, Prowlarr, etc.) need a real native WebView — not an iframe.
 * Plex OAuth (and similar) sets X-Frame-Options / opens target=_blank; iframes
 * either blank out or Cap/Android routes the login to system Chrome. Capgo's
 * openWebView keeps http(s) + window.open popups inside the app.
 */
export function WebPanel({ service, onBack }: WebPanelProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const url = service.url.trim();
  const native = Capacitor.isNativePlatform();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const openedRef = useRef(false);

  const openExternal = useCallback(async () => {
    if (!url) return;
    try {
      // Intentional escape hatch only — never used for OAuth.
      await Browser.open({ url });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [url]);

  const handleBack = useCallback(async () => {
    if (native && openedRef.current) {
      try {
        await InAppBrowser.close();
      } catch {
        /* already closed */
      }
      openedRef.current = false;
    }
    onBackRef.current();
  }, [native]);

  useEffect(() => {
    if (!native || !url) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    openedRef.current = false;

    const run = async () => {
      const closeHandle = await InAppBrowser.addListener("closeEvent", () => {
        if (cancelled) return;
        openedRef.current = false;
        onBackRef.current();
      });
      const loadedHandle = await InAppBrowser.addListener(
        "browserPageLoaded",
        () => {
          if (!cancelled) {
            setLoading(false);
            setFailed(false);
          }
        },
      );
      const errorHandle = await InAppBrowser.addListener(
        "pageLoadError",
        () => {
          // Ignore mid-OAuth redirects / transient failures; keep the session.
        },
      );

      try {
        await InAppBrowser.openWebView({
          url,
          title: service.name,
          toolbarType: ToolBarType.NAVIGATION,
          backgroundColor: BackgroundColor.BLACK,
          activeNativeNavigationForWebview: true,
          showReloadButton: true,
          // Keep OAuth / target=_blank inside this WebView — do not hand off
          // to system Chrome (that was the Ombi→Plex breakout).
          preventDeeplink: true,
          // Enables setSupportMultipleWindows + in-app popup WebViews for
          // window.open (Plex / OAuth providers often use popups).
          enableGooglePaySupport: true,
        });
        if (!cancelled) {
          openedRef.current = true;
          setLoading(false);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }

      return () => {
        void closeHandle.remove();
        void loadedHandle.remove();
        void errorHandle.remove();
      };
    };

    let removeListeners: (() => void) | undefined;
    void run().then((cleanup) => {
      removeListeners = cleanup;
    });

    return () => {
      cancelled = true;
      removeListeners?.();
      if (openedRef.current) {
        openedRef.current = false;
        void InAppBrowser.close().catch(() => undefined);
      }
      void InAppBrowser.removeAllListeners().catch(() => undefined);
    };
  }, [native, url, service.name]);

  return (
    <div className="page luna-page web-panel-page">
      <header className="luna-top">
        <button
          type="button"
          className="icon-btn"
          onClick={() => void handleBack()}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id={service.id} color={service.color} size={22} />
          {service.name}
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void openExternal()}
          aria-label="Open in browser"
          title="Open externally"
        >
          ↗
        </button>
      </header>

      {!url ? (
        <p className="hint">Set a URL for {service.name} in Settings.</p>
      ) : native ? (
        <div className="web-frame-wrap">
          {loading && !failed && (
            <p className="hint web-loading">Opening {service.name}…</p>
          )}
          {failed && (
            <div className="empty-card web-blocked">
              <strong>Couldn&apos;t open in-app browser</strong>
              <p>
                Try again, or open {service.name} in the system browser as a
                fallback.
              </p>
              <button
                type="button"
                className="btn chip"
                onClick={() => void openExternal()}
              >
                Open externally
              </button>
            </div>
          )}
          {!failed && !loading && (
            <p className="hint web-loading">
              {service.name} is open in the in-app browser. Close it to return
              here.
            </p>
          )}
        </div>
      ) : (
        <div className="web-frame-wrap">
          {loading && !failed && (
            <p className="hint web-loading">Loading {service.name}…</p>
          )}
          {failed && (
            <div className="empty-card web-blocked">
              <strong>Couldn&apos;t embed this page</strong>
              <p>
                Some services block framing in the desktop browser. Open{" "}
                {service.name} in a new tab instead.
              </p>
              <button
                type="button"
                className="btn chip"
                onClick={() => void openExternal()}
              >
                Open externally
              </button>
            </div>
          )}
          <iframe
            className="web-frame"
            src={url}
            title={service.name}
            onLoad={() => {
              setLoading(false);
              setFailed(false);
            }}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            referrerPolicy="no-referrer"
            allow="fullscreen"
          />
        </div>
      )}
    </div>
  );
}
