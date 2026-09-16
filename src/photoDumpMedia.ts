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

type PhotoDumpMediaPlugin = {
  pickMedia(options?: {
    multiple?: boolean;
  }): Promise<{ items: PhotoDumpMediaItem[] }>;
  queryMonth(options: {
    year: number;
    month: number;
  }): Promise<PhotoDumpMediaMonthResult>;
  readUriBase64(options: { uri: string }): Promise<PhotoDumpMediaReadResult>;
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

export async function readPhotoDumpMediaBase64(
  uri: string,
): Promise<PhotoDumpMediaReadResult> {
  if (!isPhotoDumpMediaNative()) {
    throw new Error("Native URI read is only available on Android.");
  }
  return PhotoDumpMedia.readUriBase64({ uri });
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
