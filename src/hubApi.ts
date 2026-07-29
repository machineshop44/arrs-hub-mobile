export type ServiceHealth = {
  up: boolean | null;
  latencyMs: number | null;
  lastChecked: string | null;
  consecutiveFails?: number;
  message?: string;
};

export type PcHealth = {
  online: boolean | null;
  lastChecked?: string | null;
  message?: string;
  method?: string | null;
};

export type WatchTarget = {
  id: string;
  name: string;
  url?: string;
};

export type WatchPc = {
  id: string;
  name: string;
  host?: string;
  mac?: string;
};

export type WatchdogStatus = {
  settings?: {
    enabled?: boolean;
    pcs?: WatchPc[];
  };
  targets?: WatchTarget[];
  services?: Record<string, ServiceHealth>;
  pcs?: Record<string, PcHealth>;
};

const HUB_URL_KEY = "arrs-hub-base-url";

export function normalizeHubUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

export function loadHubUrl(): string {
  try {
    return localStorage.getItem(HUB_URL_KEY) || "";
  } catch {
    return "";
  }
}

export function saveHubUrl(url: string): void {
  const normalized = normalizeHubUrl(url);
  localStorage.setItem(HUB_URL_KEY, normalized);
}

export async function fetchHubHealth(baseUrl: string): Promise<boolean> {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: "GET",
    cache: "no-store",
  });
  return res.ok;
}

export async function fetchWatchdogStatus(
  baseUrl: string,
): Promise<WatchdogStatus> {
  const res = await fetch(`${baseUrl}/api/watchdog/status`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Watchdog status failed (${res.status})`);
  }
  return res.json();
}
