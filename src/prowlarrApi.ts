import { httpRequest, normalizeBase } from "./http";
import type { ServiceConfig } from "./services";

export type ProwlarrIndexer = {
  id: number;
  name: string;
  protocol: string;
  enabled: boolean;
  priority: number;
  /** Set when Prowlarr has disabled the indexer after failures. */
  disabledTill: string | null;
  failureMessage: string;
};

function headers(service: ServiceConfig): Record<string, string> {
  const key = service.apiKey.trim();
  if (!key) throw new Error("Prowlarr API key is not set (Settings → Prowlarr).");
  return { Accept: "application/json", "Content-Type": "application/json", "X-Api-Key": key };
}

async function prowlarr(
  service: ServiceConfig,
  path: string,
  method = "GET",
  data?: unknown,
  timeoutMs = 20000,
) {
  const base = normalizeBase(service.url);
  if (!base) throw new Error("Prowlarr URL is not set.");
  return httpRequest(`${base}${path}`, { method, headers: headers(service), data, timeoutMs });
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export function mergeProwlarrIndexers(
  indexers: unknown,
  statuses: unknown,
): ProwlarrIndexer[] {
  const statusById = new Map<number, Record<string, unknown>>();
  for (const s of rows(statuses)) {
    const id = Number(s.indexerId);
    if (Number.isFinite(id)) statusById.set(id, s);
  }
  return rows(indexers)
    .map((row) => {
      const id = Number(row.id);
      const status = statusById.get(id);
      const till = status?.disabledTill ? String(status.disabledTill) : null;
      const active = till != null && new Date(till).getTime() > Date.now();
      return {
        id,
        name: String(row.name || `Indexer ${id}`),
        protocol: String(row.protocol || ""),
        enabled: row.enable !== false,
        priority: Number(row.priority) || 25,
        disabledTill: active ? till : null,
        failureMessage: status
          ? String(status.mostRecentFailure || status.message || "").trim()
          : "",
      };
    })
    .filter((i) => Number.isFinite(i.id))
    .sort((a, b) => {
      const af = a.disabledTill ? 0 : 1;
      const bf = b.disabledTill ? 0 : 1;
      return af - bf || a.name.localeCompare(b.name);
    });
}

export async function fetchProwlarrIndexers(
  service: ServiceConfig,
): Promise<ProwlarrIndexer[]> {
  const [idx, status] = await Promise.all([
    prowlarr(service, "/api/v1/indexer"),
    prowlarr(service, "/api/v1/indexerstatus"),
  ]);
  if (idx.status >= 400) throw new Error(`Indexers failed (HTTP ${idx.status})`);
  return mergeProwlarrIndexers(idx.data, status.status < 400 ? status.data : []);
}

export type ProwlarrTestResult = { id: number; ok: boolean; error: string };

/** Tests every enabled indexer; Prowlarr returns per-indexer validation. */
export async function testAllProwlarrIndexers(
  service: ServiceConfig,
): Promise<ProwlarrTestResult[]> {
  const res = await prowlarr(service, "/api/v1/indexer/testall", "POST", {}, 120000);
  if (res.status >= 500) throw new Error(`Test all failed (HTTP ${res.status})`);
  return rows(res.data).map((r) => {
    const failures = rows(r.validationFailures);
    return {
      id: Number(r.id),
      ok: r.isValid !== false && failures.length === 0,
      error: failures.map((f) => String(f.errorMessage || "")).filter(Boolean).join("; "),
    };
  });
}

export async function testProwlarrIndexer(
  service: ServiceConfig,
  id: number,
): Promise<ProwlarrTestResult> {
  const got = await prowlarr(service, `/api/v1/indexer/${id}`);
  if (got.status >= 400) throw new Error(`Indexer ${id} not found`);
  const res = await prowlarr(service, "/api/v1/indexer/test", "POST", got.data, 60000);
  if (res.status >= 200 && res.status < 300) return { id, ok: true, error: "" };
  const failures = rows(res.data);
  return {
    id,
    ok: false,
    error:
      failures.map((f) => String(f.errorMessage || "")).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`,
  };
}
