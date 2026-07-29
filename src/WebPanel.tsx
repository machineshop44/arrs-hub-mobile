import { Browser } from "@capacitor/browser";
import { useCallback, useState } from "react";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";

interface WebPanelProps {
  service: ServiceConfig;
  onBack: () => void;
}

export function WebPanel({ service, onBack }: WebPanelProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const url = service.url.trim();

  const openExternal = useCallback(async () => {
    if (!url) return;
    try {
      await Browser.open({ url });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [url]);

  return (
    <div className="page luna-page web-panel-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
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
      ) : (
        <div className="web-frame-wrap">
          {loading && !failed && <p className="hint web-loading">Loading {service.name}…</p>}
          {failed && (
            <div className="empty-card web-blocked">
              <strong>Couldn&apos;t embed this page</strong>
              <p>
                Some services block in-app framing. Open {service.name} in the
                system browser instead.
              </p>
              <button type="button" className="btn chip" onClick={() => void openExternal()}>
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
