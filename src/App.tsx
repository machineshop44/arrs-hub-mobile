import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrPanel } from "./ArrPanel";
import {
  loadServices,
  probeService,
  saveServices,
  type ProbeResult,
} from "./probe";
import type { ServiceConfig } from "./services";

type Screen = "status" | "settings" | "arr";

export function App() {
  const [screen, setScreen] = useState<Screen>("status");
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [health, setHealth] = useState<Record<string, ProbeResult>>({});
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<ServiceConfig | null>(null);

  useEffect(() => {
    void (async () => {
      setServices(await loadServices());
      setReady(true);
    })();
  }, []);

  const enabled = useMemo(
    () => services.filter((s) => s.enabled && s.url.trim()),
    [services],
  );

  const refresh = useCallback(async () => {
    if (!enabled.length) {
      setHealth({});
      return;
    }
    setRefreshing(true);
    const next: Record<string, ProbeResult> = {};
    await Promise.all(
      enabled.map(async (service) => {
        next[service.id] = await probeService(service);
      }),
    );
    setHealth(next);
    setRefreshing(false);
  }, [enabled]);

  useEffect(() => {
    if (!ready || screen !== "status") return;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [ready, screen, refresh]);

  const persist = async (next: ServiceConfig[]) => {
    setServices(next);
    await saveServices(next);
  };

  const openService = (service: ServiceConfig) => {
    if (service.probe === "arr") {
      setActive(service);
      setScreen("arr");
      return;
    }
    setScreen("settings");
  };

  if (!ready) {
    return (
      <div className="page">
        <p className="hint">Loading…</p>
      </div>
    );
  }

  if (screen === "arr" && active) {
    return (
      <ArrPanel
        service={active}
        onBack={() => {
          setScreen("status");
          setActive(null);
        }}
      />
    );
  }

  if (screen === "settings") {
    return (
      <div className="page">
        <header className="top compact">
          <div className="top-row">
            <h1>Settings</h1>
            <button
              type="button"
              className="btn ghost tight"
              onClick={() => {
                void saveServices(services);
                setScreen("status");
              }}
            >
              Done
            </button>
          </div>
          <p className="sub">
            *arr apps use an API key (not a webpage login). Keys stay on this
            device.
          </p>
        </header>

        {services.map((service) => (
          <section key={service.id} className="card slim">
            <div className="top-row">
              <strong style={{ color: service.color }}>{service.name}</strong>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={service.enabled}
                  onChange={(e) => {
                    void persist(
                      services.map((s) =>
                        s.id === service.id
                          ? { ...s, enabled: e.target.checked }
                          : s,
                      ),
                    );
                  }}
                />
                <span>On</span>
              </label>
            </div>
            <label className="field">
              <span>URL</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                value={service.url}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((s) =>
                      s.id === service.id ? { ...s, url: e.target.value } : s,
                    ),
                  )
                }
                onBlur={() => void saveServices(services)}
              />
            </label>
            {service.auth === "apiKey" && (
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={service.apiKey}
                  placeholder="Paste API key"
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((s) =>
                        s.id === service.id
                          ? { ...s, apiKey: e.target.value }
                          : s,
                      ),
                    )
                  }
                  onBlur={() => void saveServices(services)}
                />
              </label>
            )}
            {service.auth === "userPass" && (
              <>
                <label className="field">
                  <span>Username</span>
                  <input
                    type="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    value={service.username}
                    onChange={(e) =>
                      setServices((prev) =>
                        prev.map((s) =>
                          s.id === service.id
                            ? { ...s, username: e.target.value }
                            : s,
                        ),
                      )
                    }
                    onBlur={() => void saveServices(services)}
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={service.password}
                    onChange={(e) =>
                      setServices((prev) =>
                        prev.map((s) =>
                          s.id === service.id
                            ? { ...s, password: e.target.value }
                            : s,
                        ),
                      )
                    }
                    onBlur={() => void saveServices(services)}
                  />
                </label>
              </>
            )}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top compact">
        <div className="top-row">
          <h1>Arrs</h1>
          <button
            type="button"
            className="btn ghost tight"
            onClick={() => setScreen("settings")}
          >
            Settings
          </button>
        </div>
        <button
          type="button"
          className="btn ghost tight refresh"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </header>

      <section className="list tight">
        {enabled.map((service) => {
          const result = health[service.id];
          const up = result?.up;
          const statusClass =
            up === true
              ? "status-up"
              : up === false
                ? "status-down"
                : "status-unknown";
          return (
            <button
              type="button"
              key={service.id}
              className={`row compact ${statusClass}`}
              style={{ "--accent": service.color } as CSSProperties}
              onClick={() => openService(service)}
            >
              <span className={`status-dot ${statusClass}`} aria-hidden="true" />
              <span className="row-name">{service.name}</span>
              <span className={`status-dot ${statusClass}`} aria-hidden="true" />
            </button>
          );
        })}
      </section>
    </div>
  );
}
