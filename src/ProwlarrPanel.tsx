import { useCallback, useEffect, useState } from "react";
import { useAndroidBackHandler } from "./androidBack";
import { ServiceIcon } from "./icons";
import {
  fetchProwlarrIndexers,
  testAllProwlarrIndexers,
  testProwlarrIndexer,
  type ProwlarrIndexer,
  type ProwlarrTestResult,
} from "./prowlarrApi";
import type { ServiceConfig } from "./services";

interface ProwlarrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenWeb: () => void;
}

export function ProwlarrPanel({
  service,
  onBack,
  onOpenSettings,
  onOpenWeb,
}: ProwlarrPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [indexers, setIndexers] = useState<ProwlarrIndexer[]>([]);
  const [results, setResults] = useState<Record<number, ProwlarrTestResult>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  useAndroidBackHandler(() => {
    onBack();
    return true;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIndexers(await fetchProwlarrIndexers(service));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const onTestAll = async () => {
    setTestingAll(true);
    setMessage(null);
    setError(null);
    try {
      const list = await testAllProwlarrIndexers(service);
      setResults(Object.fromEntries(list.map((r) => [r.id, r])));
      const failed = list.filter((r) => !r.ok).length;
      setMessage(
        failed
          ? `${failed} of ${list.length} indexers failed the test.`
          : `All ${list.length} indexers passed.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingAll(false);
    }
  };

  const onTestOne = async (indexer: ProwlarrIndexer) => {
    setTestingId(indexer.id);
    setError(null);
    try {
      const r = await testProwlarrIndexer(service, indexer.id);
      setResults((prev) => ({ ...prev, [r.id]: r }));
      setMessage(r.ok ? `${indexer.name} passed.` : `${indexer.name} failed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingId(null);
    }
  };

  const failing = indexers.filter((i) => i.disabledTill || results[i.id]?.ok === false);
  const enabled = indexers.filter((i) => i.enabled).length;

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="prowlarr" color={service.color} size={22} />
          Prowlarr
        </h1>
        <button type="button" className="icon-btn" onClick={() => void load()} aria-label="Refresh">
          ↻
        </button>
      </header>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {message && !error && <p className="ok banner">{message}</p>}

      <div className="luna-subheader">
        <strong>
          {enabled} enabled · {failing.length} failing
        </strong>
        <span className="arr-item-actions" style={{ margin: 0 }}>
          <button
            type="button"
            className="btn chip primary"
            disabled={testingAll || loading || !service.apiKey.trim()}
            onClick={() => void onTestAll()}
          >
            {testingAll ? "Testing…" : "Test all"}
          </button>
          <button type="button" className="btn chip" onClick={onOpenWeb}>
            Web UI
          </button>
        </span>
      </div>

      {loading && <p className="hint">Loading indexers…</p>}

      {!loading && indexers.length === 0 && !error && (
        <div className="empty-card">
          <strong>No indexers</strong>
          <p>Add indexers in the Prowlarr web UI.</p>
        </div>
      )}

      <ul className="arr-list">
        {indexers.map((indexer) => {
          const result = results[indexer.id];
          const bad = Boolean(indexer.disabledTill) || result?.ok === false;
          return (
            <li key={indexer.id} className={`arr-item${bad ? " arr-queue-item attention" : ""}`}>
              <strong>{indexer.name}</strong>
              <span className="meta">
                {[
                  indexer.protocol,
                  indexer.enabled ? "enabled" : "disabled",
                  `priority ${indexer.priority}`,
                  result ? (result.ok ? "test passed" : "test failed") : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {indexer.disabledTill && (
                <span className="meta">
                  Backed off until{" "}
                  {new Date(indexer.disabledTill).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {indexer.failureMessage ? ` — ${indexer.failureMessage}` : ""}
                </span>
              )}
              {result && !result.ok && result.error && (
                <span className="meta">{result.error}</span>
              )}
              <div className="arr-item-actions">
                <button
                  type="button"
                  className="btn chip"
                  disabled={testingId != null || testingAll}
                  onClick={() => void onTestOne(indexer)}
                >
                  {testingId === indexer.id ? "Testing…" : "Test"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
