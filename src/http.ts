import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { mergeHubAuthHeaders } from "./hubAuth";

export type HttpResponse = {
  status: number;
  data: unknown;
  latencyMs: number;
  /** Lower-cased names. Browsers hide Set-Cookie; native returns it. */
  headers?: Record<string, string>;
};

function lowerHeaders(raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** CapacitorHttp returns non-JSON content types as strings. */
export function parseJsonMaybe(data: unknown): unknown {
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return data;
  }
}

/** Native HTTP on device (no CORS), fetch in the browser. */
export async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<HttpResponse> {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers ?? {};
  const timeoutMs = options.timeoutMs ?? 20000;
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
      data: parseJsonMaybe(res.data),
      latencyMs: Math.round(performance.now() - started),
      headers: lowerHeaders(res.headers),
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
  const headersOut: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headersOut[k.toLowerCase()] = v;
  });
  return {
    status: res.status,
    data: parseJsonMaybe(text),
    latencyMs: Math.round(performance.now() - started),
    headers: headersOut,
  };
}

/** POST JSON to Arrs Hub with the Hub API token attached. */
export async function hubPostJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; data: unknown }> {
  const res = await httpRequest(url, {
    method: "POST",
    headers: mergeHubAuthHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    data: body,
    timeoutMs,
  });
  return { status: res.status, data: res.data };
}

/** GET JSON from Arrs Hub; control routes need the token, health/version don't. */
export async function hubGetJson(
  url: string,
  timeoutMs: number,
  withHubAuth = true,
): Promise<{ status: number; data: unknown; latencyMs: number }> {
  const headers = withHubAuth
    ? mergeHubAuthHeaders({ Accept: "application/json" })
    : { Accept: "application/json" };
  return httpRequest(url, { headers, timeoutMs });
}
