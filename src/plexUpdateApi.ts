import { httpRequest } from "./arrApi";

export type PlexUpdateJobPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "applying"
  | "done"
  | "error";

export type PlexUpdateJob = {
  id: string | null;
  phase: PlexUpdateJobPhase;
  progress: number;
  message: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
};

export type PlexUpdateStatus = {
  ok: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  channel: string | null;
  canInstall: boolean;
  installMethod?: "pms" | "windows-installer" | null;
  releaseState: string | null;
  downloadURL?: string | null;
  lastChecked: string | null;
  platform?: string;
  hubLocal?: boolean;
  error: string | null;
  job: PlexUpdateJob;
};

/** Body for POST /api/plex/update — matches Arrs-Hub startPlexUpdateJob. */
export type PlexUpdateStartBody = {
  download?: boolean;
  apply?: boolean;
  tonight?: boolean;
};

const JOB_PHASES: PlexUpdateJobPhase[] = [
  "idle",
  "checking",
  "downloading",
  "applying",
  "done",
  "error",
];

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function asObject(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data === "string" && data.trim()) {
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON string body — treat as empty.
    }
  }
  return {};
}

function asJob(raw: unknown): PlexUpdateJob {
  const o = asObject(raw);
  const phase = String(o.phase || "idle") as PlexUpdateJobPhase;
  return {
    id: typeof o.id === "string" ? o.id : null,
    phase: JOB_PHASES.includes(phase) ? phase : "idle",
    progress: typeof o.progress === "number" ? o.progress : 0,
    message: typeof o.message === "string" ? o.message : "",
    error: typeof o.error === "string" ? o.error : null,
    startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
    finishedAt: typeof o.finishedAt === "string" ? o.finishedAt : null,
    result: o.result ?? null,
  };
}

function asStatus(raw: unknown): PlexUpdateStatus {
  const o = asObject(raw);
  return {
    ok: o.ok !== false,
    installedVersion:
      typeof o.installedVersion === "string" ? o.installedVersion : null,
    latestVersion:
      typeof o.latestVersion === "string" ? o.latestVersion : null,
    updateAvailable: Boolean(o.updateAvailable),
    channel: typeof o.channel === "string" ? o.channel : null,
    canInstall: Boolean(o.canInstall),
    installMethod:
      o.installMethod === "pms" || o.installMethod === "windows-installer"
        ? o.installMethod
        : null,
    releaseState:
      typeof o.releaseState === "string" ? o.releaseState : null,
    downloadURL:
      typeof o.downloadURL === "string" ? o.downloadURL : null,
    lastChecked: typeof o.lastChecked === "string" ? o.lastChecked : null,
    platform: typeof o.platform === "string" ? o.platform : undefined,
    hubLocal: typeof o.hubLocal === "boolean" ? o.hubLocal : undefined,
    error: typeof o.error === "string" ? o.error : null,
    job: asJob(o.job),
  };
}

function httpError(
  url: string,
  status: number,
  json: Record<string, unknown>,
  fallback: string,
): Error {
  // 404 almost always means an older hub without the Plex update routes —
  // prefer the upgrade hint over a generic "not found" body.
  const detail =
    status === 404
      ? fallback
      : typeof json.error === "string" && json.error.trim()
        ? json.error.trim()
        : fallback;
  return new Error(
    `${detail}\nTried: ${url}${status ? ` (HTTP ${status})` : ""}`,
  );
}

function missingApiFallback(status: number, otherwise: string): string {
  return status === 404
    ? "Hub missing Plex update API — update Arrs Hub on the PC."
    : otherwise;
}

async function plexJson(
  hubBaseUrl: string,
  pathWithQuery: string,
  options: {
    method?: "GET" | "POST";
    data?: unknown;
    timeoutMs?: number;
    errorFallback: (status: number) => string;
  },
): Promise<Record<string, unknown>> {
  const base = normalizeBase(hubBaseUrl);
  if (!base) {
    throw new Error("Arrs Hub URL is not set.");
  }
  const url = `${base}${pathWithQuery}`;
  try {
    const res = await httpRequest(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.data !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(options.data !== undefined ? { data: options.data } : {}),
      timeoutMs: options.timeoutMs ?? 20000,
    });
    const json = asObject(res.data);
    if (res.status < 200 || res.status >= 300) {
      throw httpError(
        url,
        res.status,
        json,
        options.errorFallback(res.status),
      );
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Tried:")) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\nTried: ${url}`);
  }
}

/** Short display version (strip build suffix after -). */
export function shortPlexVersion(version: string | null | undefined): string {
  if (!version) return "—";
  return version.split("-")[0] || version;
}

export function plexJobBusy(job: PlexUpdateJob | null | undefined): boolean {
  if (!job) return false;
  return (
    job.phase === "checking" ||
    job.phase === "downloading" ||
    job.phase === "applying"
  );
}

/** True when hub status says an install can actually run (PMS or Windows path). */
export function plexStatusAllowsInstall(
  status: PlexUpdateStatus | null | undefined,
): boolean {
  if (!status?.updateAvailable) return false;
  if (status.canInstall) return true;
  // Unblock when hub reports the Windows installer path even if an older
  // build left canInstall=false inconsistently.
  return (
    status.installMethod === "windows-installer" &&
    status.hubLocal === true &&
    Boolean(status.downloadURL)
  );
}

/** GET /api/plex/update-status — optional refresh=1 triggers PMS updater check. */
export async function fetchPlexUpdateStatus(
  hubBaseUrl: string,
  options: { refresh?: boolean; timeoutMs?: number } = {},
): Promise<PlexUpdateStatus> {
  const qs = options.refresh ? "?refresh=1" : "";
  const json = await plexJson(hubBaseUrl, `/api/plex/update-status${qs}`, {
    timeoutMs: options.timeoutMs ?? 20000,
    errorFallback: (status) =>
      missingApiFallback(
        status,
        `Hub returned HTTP ${status}. Is Arrs Hub online?`,
      ),
  });
  return asStatus(json);
}

/**
 * POST /api/plex/update → 202
 * Defaults on hub: download=true, apply=true unless explicitly false.
 */
export async function startPlexUpdateJob(
  hubBaseUrl: string,
  body: PlexUpdateStartBody = {},
  timeoutMs = 15000,
): Promise<{ ok: boolean; job: PlexUpdateJob }> {
  const json = await plexJson(hubBaseUrl, "/api/plex/update", {
    method: "POST",
    data: body,
    timeoutMs,
    errorFallback: (status) =>
      missingApiFallback(
        status,
        status === 409
          ? "A Plex update job is already running."
          : `Hub returned HTTP ${status}.`,
      ),
  });
  return { ok: json.ok !== false, job: asJob(json.job) };
}

/** GET /api/plex/update-job — poll in-progress job. */
export async function fetchPlexUpdateJob(
  hubBaseUrl: string,
  timeoutMs = 10000,
): Promise<PlexUpdateJob> {
  const json = await plexJson(hubBaseUrl, "/api/plex/update-job", {
    timeoutMs,
    errorFallback: (status) =>
      missingApiFallback(status, `Hub returned HTTP ${status}.`),
  });
  return asJob(json.job);
}
