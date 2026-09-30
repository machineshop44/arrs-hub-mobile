import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type PhotoDumpMediaItem = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type PhotoDumpMediaReadResult = {
  base64: string;
  name: string;
  mimeType: string;
  size: number;
};

export type PhotoDumpMediaDeleteResult = {
  deleted: boolean;
  deletedCount?: number;
  message?: string;
};

export type PhotoDumpMediaMonthResult = {
  items: PhotoDumpMediaItem[];
  year: number;
  month: number;
  count: number;
};

export type PhotoDumpAlbum = {
  id: string;
  name: string;
  count: number;
  coverUri?: string;
};

export type PhotoDumpAlbumResult = {
  items: PhotoDumpMediaItem[];
  bucketId: string;
  count: number;
};

type PhotoDumpMediaPlugin = {
  pickMedia(options?: {
    multiple?: boolean;
  }): Promise<{ items: PhotoDumpMediaItem[] }>;
  queryMonth(options: {
    year: number;
    month: number;
  }): Promise<PhotoDumpMediaMonthResult>;
  listAlbums(): Promise<{ albums: PhotoDumpAlbum[]; count: number }>;
  queryAlbum(options: { bucketId: string }): Promise<PhotoDumpAlbumResult>;
  readUriBase64(options: { uri: string }): Promise<PhotoDumpMediaReadResult>;
  hashUri(options: { uri: string }): Promise<{
    sha256: string;
    size: number;
    name: string;
    mimeType: string;
  }>;
  uploadUri(options: {
    uri: string;
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    expectedSize?: number;
  }): Promise<{ status: number; data: string; sent: number }>;
  thumbnailBase64(options: {
    uri: string;
    maxSize?: number;
  }): Promise<{ base64: string; mimeType: string; size: number }>;
  deleteUri(options: { uri: string }): Promise<PhotoDumpMediaDeleteResult>;
  deleteUris(options: { uris: string[] }): Promise<PhotoDumpMediaDeleteResult>;
  consumeSharedMedia(): Promise<{ items: PhotoDumpMediaItem[]; count: number }>;
  addListener(
    eventName: "shareReceived",
    listenerFunc: (event: {
      items: PhotoDumpMediaItem[];
      count: number;
    }) => void,
  ): Promise<PluginListenerHandle>;
};

const PhotoDumpMedia = registerPlugin<PhotoDumpMediaPlugin>("PhotoDumpMedia");

/** Cap concurrent native thumbnail decodes (large gallery grids). */
const THUMB_CONCURRENCY = 3;
let thumbActive = 0;
const thumbWaiters: Array<() => void> = [];

async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbActive >= THUMB_CONCURRENCY) {
    await new Promise<void>((resolve) => thumbWaiters.push(resolve));
  }
  thumbActive += 1;
  try {
    return await fn();
  } finally {
    thumbActive -= 1;
    const next = thumbWaiters.shift();
    if (next) next();
  }
}

export function isPhotoDumpMediaNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function normalizeSharedItems(raw: unknown): PhotoDumpMediaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const uri = String(o.uri || "").trim();
      if (!uri) return null;
      return {
        uri,
        name: String(o.name || "media").trim() || "media",
        mimeType: String(o.mimeType || "application/octet-stream"),
        size: typeof o.size === "number" && Number.isFinite(o.size) ? o.size : 0,
      };
    })
    .filter((item): item is PhotoDumpMediaItem => item != null);
}

/** Drain Android Share-sheet media (Photos / Gallery → Share → Photo Dump). */
export async function consumeSharedPhotoDumpMedia(): Promise<PhotoDumpMediaItem[]> {
  if (!isPhotoDumpMediaNative()) return [];
  try {
    const res = await PhotoDumpMedia.consumeSharedMedia();
    return normalizeSharedItems(res.items);
  } catch (err) {
    console.warn(
      "[photoDump] consumeSharedMedia failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Listen for shares while the app is already open (singleTask onNewIntent). */
export async function addSharedPhotoDumpListener(
  listener: (items: PhotoDumpMediaItem[]) => void,
): Promise<PluginListenerHandle | null> {
  if (!isPhotoDumpMediaNative()) return null;
  return PhotoDumpMedia.addListener("shareReceived", (event) => {
    listener(normalizeSharedItems(event?.items));
  });
}

export async function pickPhotoDumpMedia(
  multiple = true,
): Promise<PhotoDumpMediaItem[]> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Native gallery pick is only available on Android.");
  }
  const res = await PhotoDumpMedia.pickMedia({ multiple });
  return Array.isArray(res.items) ? res.items : [];
}

export async function queryPhotoDumpMediaMonth(
  year: number,
  month: number,
): Promise<PhotoDumpMediaMonthResult> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Whole-month MediaStore query is only available on Android.");
  }
  return PhotoDumpMedia.queryMonth({ year, month });
}

export async function listPhotoDumpAlbums(): Promise<PhotoDumpAlbum[]> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Album browse is only available on Android.");
  }
  const res = await PhotoDumpMedia.listAlbums();
  const raw = Array.isArray(res.albums) ? res.albums : [];
  const out: PhotoDumpAlbum[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    if (!id) continue;
    const album: PhotoDumpAlbum = {
      id,
      name: String(row.name || "Album").trim() || "Album",
      count: typeof row.count === "number" ? row.count : 0,
    };
    if (row.coverUri) album.coverUri = String(row.coverUri);
    out.push(album);
  }
  return out;
}

export async function queryPhotoDumpAlbum(
  bucketId: string,
): Promise<PhotoDumpAlbumResult> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Album query is only available on Android.");
  }
  return PhotoDumpMedia.queryAlbum({ bucketId });
}

export async function readPhotoDumpMediaBase64(
  uri: string,
): Promise<PhotoDumpMediaReadResult> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Native URI read is only available on Android.");
  }
  return PhotoDumpMedia.readUriBase64({ uri });
}

/** Stream SHA-256 without loading the whole file into the WebView (avoids OOM). */
export async function hashPhotoDumpMediaUri(uri: string): Promise<{
  sha256: string;
  size: number;
  name: string;
  mimeType: string;
}> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Native URI hash is only available on Android.");
  }
  const res = await PhotoDumpMedia.hashUri({ uri });
  return {
    sha256: String(res.sha256 || "").toLowerCase(),
    size: typeof res.size === "number" ? res.size : 0,
    name: String(res.name || "media"),
    mimeType: String(res.mimeType || "application/octet-stream"),
  };
}

/** Stream ContentResolver bytes straight to Hub (no base64 in JS). */
export async function uploadPhotoDumpMediaUri(opts: {
  uri: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  expectedSize: number;
}): Promise<{ status: number; data: unknown; sent: number }> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Native URI upload is only available on Android.");
  }
  const res = await PhotoDumpMedia.uploadUri({
    uri: opts.uri,
    url: opts.url,
    headers: opts.headers,
    timeoutMs: opts.timeoutMs,
    expectedSize: opts.expectedSize,
  });
  let data: unknown = res.data;
  if (typeof data === "string" && data.trim()) {
    try {
      data = JSON.parse(data);
    } catch {
      // keep raw string
    }
  }
  return {
    status: typeof res.status === "number" ? res.status : 0,
    data,
    sent: typeof res.sent === "number" ? res.sent : opts.expectedSize,
  };
}

/** Small JPEG data-URL for gallery grid (images + videos). */
export async function readPhotoDumpThumbnailDataUrl(
  uri: string,
  maxSize = 256,
): Promise<string | null> {
  if (!isPhotoDumpMediaNative()) return null;
  return withThumbSlot(async () => {
    try {
      const res = await PhotoDumpMedia.thumbnailBase64({ uri, maxSize });
      const b64 = String(res.base64 || "").trim();
      if (!b64) return null;
      const mime = String(res.mimeType || "image/jpeg");
      return `data:${mime};base64,${b64}`;
    } catch {
      return null;
    }
  });
}

export async function deletePhotoDumpMediaUri(
  uri: string,
): Promise<PhotoDumpMediaDeleteResult> {
  if (!isPhotoDumpMediaNative()) {
    return {
      deleted: false,
      message: "Native gallery delete is only available on Android.",
    };
  }
  return PhotoDumpMedia.deleteUri({ uri });
}

/** Prefer this after a multi-file dump — one system confirmation on Android 11+. */
export async function deletePhotoDumpMediaUris(
  uris: string[],
): Promise<PhotoDumpMediaDeleteResult> {
  const list = uris.map((u) => String(u || "").trim()).filter(Boolean);
  if (list.length === 0) {
    return { deleted: true, deletedCount: 0, message: "Nothing to delete" };
  }
  if (!isPhotoDumpMediaNative()) {
    return {
      deleted: false,
      deletedCount: 0,
      message: "Native gallery delete is only available on Android.",
    };
  }
  if (list.length === 1) {
    const one = await PhotoDumpMedia.deleteUri({ uri: list[0] });
    return {
      ...one,
      deletedCount: one.deleted ? 1 : (one.deletedCount ?? 0),
    };
  }
  return PhotoDumpMedia.deleteUris({ uris: list });
}

/** Decode plugin base64 into an ArrayBuffer for hashing/upload. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
