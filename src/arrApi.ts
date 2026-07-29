import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { ServiceConfig } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; data: unknown; latencyMs: number }> {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers ?? {};
  const timeoutMs = options.timeoutMs ?? 12000;
  const started = performance.now();

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: options.data,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    return {
      status: res.status,
      data: res.data,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const res = await fetch(url, {
    method,
    headers,
    body:
      options.data === undefined
        ? undefined
        : typeof options.data === "string"
          ? options.data
          : JSON.stringify(options.data),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return {
    status: res.status,
    data,
    latencyMs: Math.round(performance.now() - started),
  };
}

export function arrHeaders(service: ServiceConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (service.apiKey.trim()) headers["X-Api-Key"] = service.apiKey.trim();
  return headers;
}

export async function arrGet(service: ServiceConfig, apiPath: string) {
  const base = normalizeBase(service.url);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return httpRequest(`${base}${path}`, {
    headers: arrHeaders(service),
  });
}

export type ArrQueueItem = {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  sizeleft?: number;
  timeleft?: string;
};

export type ArrWantedItem = {
  id: number;
  title: string;
  status?: string;
};

export type ArrCalendarItem = {
  id: number;
  title: string;
  airDateUtc?: string;
  releaseDate?: string;
  hasFile?: boolean;
};

function asRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { records?: unknown }).records)) {
    return (data as { records: Record<string, unknown>[] }).records;
  }
  return [];
}

export async function fetchArrOverview(service: ServiceConfig) {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7);
  const end = endDate.toISOString().slice(0, 10);

  const [statusRes, queueRes, wantedRes, calendarRes] = await Promise.all([
    arrGet(service, "/api/v3/system/status"),
    arrGet(service, "/api/v3/queue?pageSize=20"),
    arrGet(service, "/api/v3/wanted/missing?pageSize=20&sortKey=airDateUtc&sortDirection=descending").catch(
      async () => arrGet(service, "/api/v3/wanted/missing?pageSize=20"),
    ),
    arrGet(service, `/api/v3/calendar?start=${start}&end=${end}&unmonitored=false`),
  ]);

  const queue = asRecords(queueRes.data).map((row) => ({
    id: Number(row.id) || 0,
    title: String(row.title || row.sourceTitle || "Queue item"),
    status: String(row.status || row.trackedDownloadState || ""),
    trackedDownloadState: row.trackedDownloadState
      ? String(row.trackedDownloadState)
      : undefined,
    sizeleft: typeof row.sizeleft === "number" ? row.sizeleft : undefined,
    timeleft: row.timeleft ? String(row.timeleft) : undefined,
  })) as ArrQueueItem[];

  const wanted = asRecords(wantedRes.data).map((row) => ({
    id: Number(row.id) || 0,
    title: String(
      row.title ||
        row.seriesTitle ||
        (row.series as { title?: string } | undefined)?.title ||
        "Missing",
    ),
    status: row.status ? String(row.status) : undefined,
  })) as ArrWantedItem[];

  const calendar = asRecords(calendarRes.data).map((row) => ({
    id: Number(row.id) || 0,
    title: String(
      row.title ||
        row.seriesTitle ||
        (row.series as { title?: string } | undefined)?.title ||
        "Upcoming",
    ),
    airDateUtc: row.airDateUtc ? String(row.airDateUtc) : undefined,
    releaseDate: row.releaseDate ? String(row.releaseDate) : undefined,
    hasFile: Boolean(row.hasFile),
  })) as ArrCalendarItem[];

  const statusOk = statusRes.status >= 200 && statusRes.status < 300;
  const version =
    statusOk && statusRes.data && typeof statusRes.data === "object"
      ? String((statusRes.data as { version?: string }).version || "")
      : "";

  return {
    ok: statusOk,
    version,
    queue,
    wanted,
    calendar,
    errors: [
      statusRes.status >= 400 ? `Status ${statusRes.status}` : null,
      queueRes.status >= 400 ? `Queue ${queueRes.status}` : null,
      wantedRes.status >= 400 ? `Wanted ${wantedRes.status}` : null,
      calendarRes.status >= 400 ? `Calendar ${calendarRes.status}` : null,
    ].filter(Boolean) as string[],
  };
}

export async function triggerArrCommand(
  service: ServiceConfig,
  name: string,
): Promise<void> {
  const res = await httpRequest(`${normalizeBase(service.url)}/api/v3/command`, {
    method: "POST",
    headers: {
      ...arrHeaders(service),
      "Content-Type": "application/json",
    },
    data: { name },
  });
  if (res.status >= 400) {
    throw new Error(`Command failed (${res.status})`);
  }
}
