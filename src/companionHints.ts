import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { isCompanionOnlyUrl, type ServiceConfig } from "./services";

export function isLocalServiceUrl(url: string): boolean {
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)
      ? url
      : `http://${url}`;
    const hostname = new URL(withProto).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return true;
  }
}

/**
 * Hub stores downloader LAN URLs when Companion registers.
 * Apply them to local service URLs when still pointing at localhost.
 */
export function applyCompanionUrlHints(
  services: ServiceConfig[],
  hints: Record<string, string>,
): ServiceConfig[] {
  let changed = false;
  const next = services.map((service) => {
    const hint = hints[service.id];
    if (!hint?.trim()) return service;
    const current = service.url.trim();
    if (isCompanionOnlyUrl(current) && isCompanionOnlyUrl(hint)) {
      changed = true;
      return { ...service, url: hint.trim() };
    }
    if (isCompanionOnlyUrl(current) || isCompanionOnlyUrl(hint)) return service;
    if (!isLocalServiceUrl(current)) return service;
    changed = true;
    return { ...service, url: hint.trim() };
  });
  return changed ? next : services;
}

async function hubGetJson(
  hubBaseUrl: string,
  path: string,
  timeoutMs = 6000,
): Promise<unknown | null> {
  const base = hubBaseUrl.trim().replace(/\/+$/, "");
  if (!base) return null;

  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url: `${base}${path}`,
        headers: { Accept: "application/json" },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      if (res.status < 200 || res.status >= 400) return null;
      const data = res.data;
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
      return data;
    }

    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch companion URL hints from Arrs Hub watchdog. */
export async function fetchCompanionUrlHints(
  hubBaseUrl: string,
): Promise<Record<string, string> | null> {
  const data = await hubGetJson(
    hubBaseUrl,
    "/api/watchdog/companion-url-hints",
  );
  if (!data || typeof data !== "object") return null;
  const hints = (data as { hints?: unknown }).hints;
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) return null;
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(hints as Record<string, unknown>)) {
    if (typeof url === "string" && url.trim()) out[id] = url.trim();
  }
  return out;
}
