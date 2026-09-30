import { httpRequest, normalizeBase } from "./http";
import type { ServiceConfig } from "./services";

/**
 * Plex's server root (:32400/) answers with XML or 401 — the web app lives
 * at /web. Leave URLs that already carry a path (reverse proxy, app.plex.tv) alone.
 */
export function plexWebUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      parsed.pathname = "/web";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** URL to open in the in-app browser for a service tile. */
export function serviceWebUrl(service: Pick<ServiceConfig, "id" | "url">): string {
  return service.id === "plex" ? plexWebUrl(service.url) : service.url.trim();
}

export type PlexLibrary = { key: string; title: string; type: string };

function plexHeaders(service: ServiceConfig): Record<string, string> {
  const token = service.apiKey.trim();
  if (!token) throw new Error("Add your Plex token under Settings → Plex.");
  return { Accept: "application/json", "X-Plex-Token": token };
}

export async function fetchPlexLibraries(
  service: ServiceConfig,
): Promise<PlexLibrary[]> {
  const base = normalizeBase(service.url);
  if (!base) throw new Error("Plex URL is not set.");
  const res = await httpRequest(`${base}/library/sections`, {
    headers: plexHeaders(service),
    timeoutMs: 12000,
  });
  if (res.status === 401) throw new Error("Plex rejected the token (401).");
  if (res.status >= 400) throw new Error(`Plex HTTP ${res.status}`);
  const container = (res.data as { MediaContainer?: { Directory?: unknown[] } })
    ?.MediaContainer;
  return (Array.isArray(container?.Directory) ? container.Directory : [])
    .map((raw) => {
      const row = raw as { key?: unknown; title?: unknown; type?: unknown };
      return {
        key: String(row.key ?? ""),
        title: String(row.title ?? "Library"),
        type: String(row.type ?? ""),
      };
    })
    .filter((lib) => lib.key);
}

/** Ask Plex to rescan a library section for new files. */
export async function scanPlexLibrary(
  service: ServiceConfig,
  libraryKey: string,
): Promise<void> {
  const base = normalizeBase(service.url);
  const res = await httpRequest(
    `${base}/library/sections/${encodeURIComponent(libraryKey)}/refresh`,
    { headers: plexHeaders(service), timeoutMs: 12000 },
  );
  if (res.status >= 400) throw new Error(`Scan failed (HTTP ${res.status})`);
}

export async function scanAllPlexLibraries(service: ServiceConfig): Promise<number> {
  const libs = await fetchPlexLibraries(service);
  await Promise.all(libs.map((lib) => scanPlexLibrary(service, lib.key)));
  return libs.length;
}
