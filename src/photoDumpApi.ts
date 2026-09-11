import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { httpRequest } from "./arrApi";

/** Capacitor Preferences key for Hub photo-dump API key (also mirrored on service.apiKey). */
export const PHOTO_DUMP_API_KEY_STORAGE = "arrs-mobile-photo-dump-key-v1";

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
      // keep empty
    }
  }
  return {};
}

function formatHubHttpError(
  url: string,
  status: number,
  json: Record<string, unknown>,
  fallback: string,
): string {
  const detail =
    typeof json.error === "string" && json.error.trim()
      ? json.error.trim()
      : fallback;
  return `${detail}\nTried: ${url}${status ? ` (HTTP ${status})` : ""}`;
}

export async function loadPhotoDumpApiKey(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: PHOTO_DUMP_API_KEY_STORAGE });
    return value?.trim() || "";
  } catch (err) {
    console.warn(
      "[photoDump] Failed to read API key from Preferences:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

export async function savePhotoDumpApiKey(key: string): Promise<void> {
  await Preferences.set({
    key: PHOTO_DUMP_API_KEY_STORAGE,
    value: key.trim(),
  });
}

export type PhotoDumpPublicSettings = {
  enabled: boolean;
  rootPath: string;
  rootPathSet: boolean;
  apiKey: string;
  apiKeySet: boolean;
  maxFileBytes: number;
};

export type PhotoDumpFolderList = {
  ok: boolean;
  rootPath: string;
  path: string;
  folders: string[];
};

export type PhotoDumpUploadResult = {
  ok: boolean;
  verified: boolean;
  /** Hub skipped body because X-Content-SHA256 already indexed. */
  duplicate?: boolean;
  folder: string;
  fileName: string;
  size: number;
  sha256: string;
  path: string;
};

export async function fetchPhotoDumpSettings(
  hubUrl: string,
  apiKey?: string,
): Promise<PhotoDumpPublicSettings> {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port.",
    );
  }
  const url = `${base}/api/photo-dump/settings`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (key) {
    headers["X-Arrs-Hub-Key"] = key;
  }
  const res = await httpRequest(url, {
    method: "GET",
    headers,
    timeoutMs: 15000,
  });
  const json = asObject(res.data);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      formatHubHttpError(
        url,
        res.status,
        json,
        `Hub returned HTTP ${res.status}. Is Arrs Hub online?`,
      ),
    );
  }
  const settings = asObject(json.settings);
  return {
    enabled: settings.enabled !== false,
    rootPath: typeof settings.rootPath === "string" ? settings.rootPath : "",
    rootPathSet: Boolean(settings.rootPathSet),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
    apiKeySet: Boolean(settings.apiKeySet),
    maxFileBytes:
      typeof settings.maxFileBytes === "number" && settings.maxFileBytes > 0
        ? settings.maxFileBytes
        : 2 * 1024 * 1024 * 1024,
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error(
      "Photo dump API key is not set. Paste it from Hub Settings → Photo dump into Settings → Network (or Photo Dump module).",
    );
  }
  return {
    Accept: "application/json",
    "X-Arrs-Hub-Key": key,
  };
}

export async function listPhotoDumpFolders(
  hubUrl: string,
  apiKey: string,
  relativePath = "",
): Promise<PhotoDumpFolderList> {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port.",
    );
  }
  const q = encodeURIComponent(relativePath.replace(/\\/g, "/"));
  const url = `${base}/api/photo-dump/folders?path=${q}`;
  const res = await httpRequest(url, {
    method: "GET",
    headers: authHeaders(apiKey),
    timeoutMs: 20000,
  });
  const json = asObject(res.data);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      formatHubHttpError(
        url,
        res.status,
        json,
        `Could not list folders (HTTP ${res.status}).`,
      ),
    );
  }
  const folders = Array.isArray(json.folders)
    ? json.folders.filter((f): f is string => typeof f === "string")
    : [];
  return {
    ok: json.ok !== false,
    rootPath: typeof json.rootPath === "string" ? json.rootPath : "",
    path: typeof json.path === "string" ? json.path : relativePath,
    folders,
  };
}

export async function createPhotoDumpFolder(
  hubUrl: string,
  apiKey: string,
  relativePath: string,
): Promise<{ ok: boolean; path: string }> {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port.",
    );
  }
  const url = `${base}/api/photo-dump/folders`;
  const res = await httpRequest(url, {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "Content-Type": "application/json",
    },
    data: { path: relativePath.replace(/\\/g, "/") },
    timeoutMs: 20000,
  });
  const json = asObject(res.data);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      formatHubHttpError(
        url,
        res.status,
        json,
        `Could not create folder (HTTP ${res.status}).`,
      ),
    );
  }
  return {
    ok: json.ok !== false,
    path: typeof json.path === "string" ? json.path : relativePath,
  };
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 hex (lowercase) of file bytes via SubtleCrypto. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Upload raw octets to Hub. Only returns after Hub verifies size + hash
 * (or reports duplicate skip for an already-indexed SHA).
 * On mismatch Hub rejects and does not keep the file — caller must keep phone copy.
 */
export async function uploadPhotoDumpFile(
  hubUrl: string,
  apiKey: string,
  opts: {
    fileName: string;
    relativeFolder: string;
    bytes: ArrayBuffer;
    sha256: string;
  },
): Promise<PhotoDumpUploadResult> {
  const base = normalizeBase(hubUrl);
  if (!base) {
    throw new Error(
      "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port.",
    );
  }
  const url = `${base}/api/photo-dump/upload`;
  const size = opts.bytes.byteLength;
  const localSha = opts.sha256.toLowerCase();
  const headers: Record<string, string> = {
    ...authHeaders(apiKey),
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(opts.fileName),
    "X-Relative-Folder": encodeURIComponent(
      opts.relativeFolder.replace(/\\/g, "/"),
    ),
    "X-Content-SHA256": localSha,
    "X-Expected-Size": String(size),
  };

  // Large video uploads can take a while over WAN.
  const timeoutMs = Math.min(
    30 * 60 * 1000,
    Math.max(120_000, Math.ceil(size / 50_000) * 1000),
  );

  let status: number;
  let data: unknown;

  if (Capacitor.isNativePlatform()) {
    // Encode once, then drop the ArrayBuffer reference before the HTTP call
    // so GC can reclaim raw bytes while CapacitorHttp holds base64 only.
    // Hub may early-exit on duplicate SHA and drain/reject the body — still OK.
    const base64 = arrayBufferToBase64(opts.bytes);
    const res = await CapacitorHttp.request({
      url,
      method: "POST",
      headers,
      data: base64,
      dataType: "file",
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    status = res.status;
    data = res.data;
  } else {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: opts.bytes,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    status = res.status;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  }

  const json = asObject(data);
  if (status < 200 || status >= 300) {
    throw new Error(
      formatHubHttpError(
        url,
        status,
        json,
        `Upload failed (HTTP ${status}). Phone copy kept.`,
      ),
    );
  }

  const duplicate = json.duplicate === true;
  const result: PhotoDumpUploadResult = {
    ok: json.ok === true,
    verified: json.verified === true,
    duplicate,
    folder: typeof json.folder === "string" ? json.folder : "",
    fileName: typeof json.fileName === "string" ? json.fileName : opts.fileName,
    size: typeof json.size === "number" ? json.size : size,
    sha256: typeof json.sha256 === "string" ? json.sha256.toLowerCase() : "",
    path: typeof json.path === "string" ? json.path : "",
  };

  const shaOk = result.sha256 === localSha;
  // Duplicate skip: Hub did not receive the body; trust matching SHA (size may
  // already match the indexed file, but do not hard-require equality).
  const sizeOk = duplicate || result.size === size;

  if (!result.ok || !result.verified || !shaOk || !sizeOk) {
    throw new Error(
      duplicate
        ? "Hub duplicate response failed verification (hash mismatch). Phone copy kept."
        : "Hub did not verify upload (size/hash mismatch). Phone copy kept.",
    );
  }

  return result;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
