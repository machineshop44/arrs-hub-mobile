import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/** Capacitor Preferences key for Photo Dump background-upload toggles. */
export const PHOTO_DUMP_UPLOAD_SETTINGS_KEY = "arrs-mobile-photo-dump-upload-v1";

export type PhotoDumpUploadSettings = {
  wifiOnly: boolean;
  chargingOnly: boolean;
  autoBackup: boolean;
  /** Hub-relative folder auto-backup uploads into (captured when enabled). */
  autoFolder: string;
  /** Skip the post-upload "remove originals" prompt. */
  keepOriginals: boolean;
};

export const DEFAULT_PHOTO_DUMP_UPLOAD_SETTINGS: PhotoDumpUploadSettings = {
  wifiOnly: false,
  chargingOnly: false,
  autoBackup: false,
  autoFolder: "",
  keepOriginals: false,
};

export async function loadPhotoDumpUploadSettings(): Promise<PhotoDumpUploadSettings> {
  try {
    const { value } = await Preferences.get({ key: PHOTO_DUMP_UPLOAD_SETTINGS_KEY });
    if (!value) return { ...DEFAULT_PHOTO_DUMP_UPLOAD_SETTINGS };
    const raw = JSON.parse(value) as Partial<PhotoDumpUploadSettings>;
    return {
      wifiOnly: raw.wifiOnly === true,
      chargingOnly: raw.chargingOnly === true,
      autoBackup: raw.autoBackup === true,
      autoFolder: typeof raw.autoFolder === "string" ? raw.autoFolder : "",
      keepOriginals: raw.keepOriginals === true,
    };
  } catch {
    return { ...DEFAULT_PHOTO_DUMP_UPLOAD_SETTINGS };
  }
}

export async function savePhotoDumpUploadSettings(
  settings: PhotoDumpUploadSettings,
): Promise<void> {
  try {
    await Preferences.set({
      key: PHOTO_DUMP_UPLOAD_SETTINGS_KEY,
      value: JSON.stringify(settings),
    });
  } catch (err) {
    console.warn(
      "[photoDumpSync] save settings failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export type NativeUploadStatus =
  | "pending"
  | "hashing"
  | "uploading"
  | "done"
  | "error"
  | "cancelled";

/** One row of the native WorkManager upload queue. */
export type NativeUploadItem = {
  id: string;
  uri: string;
  name: string;
  size: number;
  mimeType: string;
  folder: string;
  /** "manual" (enqueued from the panel) or "auto" (camera auto-backup). */
  source: string;
  status: NativeUploadStatus;
  message?: string | null;
  attempts?: number;
  /** True while a transient failure is waiting for WorkManager backoff. */
  retrying?: boolean;
  duplicate?: boolean;
  remotePath?: string;
  fileName?: string;
  remoteSize?: number;
  sha256?: string;
};

export type NativeUploadCounts = {
  total: number;
  pending: number;
  active: number;
  done: number;
  failed: number;
};

export type NativeUploadStatusResult = NativeUploadCounts & {
  running: boolean;
  items: NativeUploadItem[];
};

export type NativeUploadOptions = {
  wifiOnly?: boolean;
  chargingOnly?: boolean;
  autoBackup?: boolean;
  /** Hub-relative folder for auto-backup uploads (defaults to last manual folder). */
  autoFolder?: string;
};

export type NativeUploadEvents = {
  uploadItem: NativeUploadCounts & { item: NativeUploadItem };
  uploadProgress: NativeUploadCounts & {
    label: string;
    current: number;
    runTotal: number;
  };
  uploadBytes: { id: string; bytesSent: number; bytesTotal: number };
  uploadComplete: NativeUploadCounts;
};

type PhotoDumpSyncPlugin = {
  start(options: {
    title?: string;
    text?: string;
    current?: number;
    total?: number;
  }): Promise<{ ok: boolean }>;
  update(options: {
    title?: string;
    text?: string;
    current?: number;
    total?: number;
  }): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  enqueue(
    options: {
      url: string;
      headers: Record<string, string>;
      folder: string;
      items: Array<{
        id: string;
        uri: string;
        name: string;
        size: number;
        mimeType: string;
        folder?: string;
      }>;
    } & NativeUploadOptions,
  ): Promise<{ added: string[]; queued: number }>;
  status(): Promise<NativeUploadStatusResult>;
  cancel(): Promise<{ cancelled: number }>;
  retry(options: { ids?: string[] }): Promise<{ retried: number }>;
  clear(options: { ids?: string[] }): Promise<{ removed: number }>;
  setOptions(
    options: NativeUploadOptions & {
      url?: string;
      headers?: Record<string, string>;
    },
  ): Promise<NativeUploadOptions & { configured: boolean }>;
  getOptions(): Promise<NativeUploadOptions & { configured: boolean }>;
  addListener<E extends keyof NativeUploadEvents>(
    eventName: E,
    listenerFunc: (event: NativeUploadEvents[E]) => void,
  ): Promise<PluginListenerHandle>;
};

const PhotoDumpSync = registerPlugin<PhotoDumpSyncPlugin>("PhotoDumpSync");

function native(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** Start foreground sync notification (keeps uploads alive in background). */
export async function startPhotoDumpSyncNotify(opts: {
  text?: string;
  current?: number;
  total?: number;
}): Promise<void> {
  if (!native()) return;
  try {
    await PhotoDumpSync.start({
      title: "Photo Dump",
      text: opts.text || "Uploading…",
      current: opts.current ?? 0,
      total: opts.total ?? 0,
    });
  } catch (err) {
    console.warn(
      "[photoDumpSync] start failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function updatePhotoDumpSyncNotify(opts: {
  text?: string;
  current?: number;
  total?: number;
}): Promise<void> {
  if (!native()) return;
  try {
    await PhotoDumpSync.update({
      title: "Photo Dump",
      text: opts.text || "Uploading…",
      current: opts.current ?? 0,
      total: opts.total ?? 0,
    });
  } catch {
    // ignore mid-sync update failures
  }
}

export async function stopPhotoDumpSyncNotify(): Promise<void> {
  if (!native()) return;
  try {
    await PhotoDumpSync.stop();
  } catch {
    // ignore
  }
}

// ---- Native WorkManager upload queue (Android) ----

/** True when uploads should go through the native background worker. */
export function isNativeUploadQueueAvailable(): boolean {
  return native() && Capacitor.isPluginAvailable("PhotoDumpSync");
}

export async function enqueueNativeUploads(opts: {
  url: string;
  headers: Record<string, string>;
  folder: string;
  items: Array<{
    id: string;
    uri: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
  options?: NativeUploadOptions;
}): Promise<string[]> {
  const res = await PhotoDumpSync.enqueue({
    url: opts.url,
    headers: opts.headers,
    folder: opts.folder,
    items: opts.items,
    ...(opts.options ?? {}),
  });
  return Array.isArray(res.added) ? res.added : [];
}

export async function getNativeUploadStatus(): Promise<NativeUploadStatusResult | null> {
  if (!isNativeUploadQueueAvailable()) return null;
  try {
    const res = await PhotoDumpSync.status();
    return {
      ...res,
      items: Array.isArray(res.items) ? res.items : [],
    };
  } catch (err) {
    console.warn(
      "[photoDumpSync] status failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function cancelNativeUploads(): Promise<number> {
  if (!isNativeUploadQueueAvailable()) return 0;
  try {
    return (await PhotoDumpSync.cancel()).cancelled ?? 0;
  } catch {
    return 0;
  }
}

export async function retryNativeUploads(ids?: string[]): Promise<number> {
  if (!isNativeUploadQueueAvailable()) return 0;
  const res = await PhotoDumpSync.retry(ids ? { ids } : {});
  return res.retried ?? 0;
}

/** Drop rows from the native queue (all finished rows when ids omitted). */
export async function clearNativeUploads(ids?: string[]): Promise<void> {
  if (!isNativeUploadQueueAvailable()) return;
  try {
    await PhotoDumpSync.clear(ids ? { ids } : {});
  } catch {
    // ignore
  }
}

export async function setNativeUploadOptions(
  options: NativeUploadOptions & {
    url?: string;
    headers?: Record<string, string>;
  },
): Promise<void> {
  if (!isNativeUploadQueueAvailable()) return;
  try {
    await PhotoDumpSync.setOptions(options);
  } catch (err) {
    console.warn(
      "[photoDumpSync] setOptions failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function addNativeUploadListener<E extends keyof NativeUploadEvents>(
  eventName: E,
  listener: (event: NativeUploadEvents[E]) => void,
): Promise<PluginListenerHandle | null> {
  if (!isNativeUploadQueueAvailable()) return null;
  try {
    return await PhotoDumpSync.addListener(eventName, listener);
  } catch {
    return null;
  }
}
