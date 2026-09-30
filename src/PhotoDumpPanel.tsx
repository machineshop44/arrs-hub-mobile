import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAndroidBackHandler } from "./androidBack";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";
import {
  buildPhotoDumpUploadConfig,
  createPhotoDumpFolder,
  fetchPhotoDumpSettings,
  formatBytes,
  listPhotoDumpFolders,
  loadPhotoDumpApiKey,
  savePhotoDumpApiKey,
  sha256Hex,
  uploadPhotoDumpFile,
  uploadPhotoDumpFromUri,
  type PhotoDumpPublicSettings,
} from "./photoDumpApi";
import {
  deletePhotoDumpMediaUri,
  deletePhotoDumpMediaUris,
  hashPhotoDumpMediaUri,
  isPhotoDumpMediaNative,
  listPhotoDumpAlbums,
  queryPhotoDumpAlbum,
  queryPhotoDumpMediaMonth,
  readPhotoDumpMediaBase64,
  readPhotoDumpThumbnailDataUrl,
  type PhotoDumpAlbum,
  type PhotoDumpMediaItem,
} from "./photoDumpMedia";
import { PhotoDumpQrScan } from "./PhotoDumpQrScan";
import type { PhotoDumpSetupPayload } from "./photoDumpSetupQr";
import {
  acquireScreenWakeLock,
  releaseScreenWakeLock,
} from "./screenWakeLock";
import {
  addNativeUploadListener,
  cancelNativeUploads,
  clearNativeUploads,
  DEFAULT_PHOTO_DUMP_UPLOAD_SETTINGS,
  enqueueNativeUploads,
  getNativeUploadStatus,
  isNativeUploadQueueAvailable,
  loadPhotoDumpUploadSettings,
  savePhotoDumpUploadSettings,
  setNativeUploadOptions,
  startPhotoDumpSyncNotify,
  stopPhotoDumpSyncNotify,
  updatePhotoDumpSyncNotify,
  type NativeUploadItem,
  type NativeUploadStatusResult,
  type PhotoDumpUploadSettings,
} from "./photoDumpSync";
import { photoDumpHubVersionWarning } from "./hubVersion";

interface PhotoDumpPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
  /** Persist key onto the photo-dump service so Settings stays in sync. */
  onApiKeyChange?: (apiKey: string) => void;
  /** Apply scanned Hub setup QR (API key + Hub URL). Return false if user cancelled. */
  onSetupApplied?: (
    payload: PhotoDumpSetupPayload,
  ) => boolean | void | Promise<boolean | void>;
  /** Live LAN vs remote path hint while the panel is open. */
  pathHint?: "LAN" | "Remote";
  /** Arrs Hub version from /api/health (for feature gates). */
  hubVersion?: string | null;
  /** Media shared in from Photos/Gallery (Android Share sheet). */
  sharedItems?: PhotoDumpMediaItem[];
  /** Clear parent pending-share state after enqueue. */
  onSharedItemsConsumed?: () => void;
}

type FileStatus =
  | "pending"
  /** Handed to the native background worker, waiting its turn. */
  | "queued"
  | "hashing"
  | "uploading"
  | "done"
  | "deleted"
  | "manual-remove"
  /** Verified on Hub; "Keep originals" skipped the gallery delete. */
  | "kept"
  | "error";

/** Soft cap for JS/base64 upload path (WebView OOM guard). */
export const PHOTO_DUMP_UI_MAX_FILE_BYTES = 400 * 1024 * 1024;
/** Native stream path can go up to Hub default (2 GiB). */
export const PHOTO_DUMP_NATIVE_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
/** Warn before enqueueing a whole-month dump larger than this count. */
export const PHOTO_DUMP_MONTH_WARN_COUNT = 200;

type QueueItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  /** HTML file input fallback (no gallery URI). */
  file?: File;
  /** Native MediaStore / document URI for delete-after-verify. */
  contentUri?: string;
  /** Included in next Upload & verify when pending/error. */
  selected: boolean;
  status: FileStatus;
  message?: string;
  remotePath?: string;
};

let queueIdSeq = 0;

function nextQueueId(fileName: string): string {
  queueIdSeq += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${queueIdSeq}`;
  return `${rand}-${fileName}`;
}

function joinRelative(parent: string, child: string): string {
  const p = parent.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const c = child.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!p) return c;
  if (!c) return p;
  return `${p}/${c}`;
}

function parentRelative(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function currentMonthValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function parseMonthValue(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function formatMonthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}

function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const t = year * 12 + (month - 1) + delta;
  return { year: Math.floor(t / 12), month: (t % 12) + 1 };
}

type GalleryBrowseItem = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  year: number;
  month: number;
  selected: boolean;
};

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "queued":
      return "Queued (background)";
    case "kept":
      return "Uploaded & verified — original kept";
    case "hashing":
      return "Hashing…";
    case "uploading":
      return "Uploading…";
    case "done":
      return "Verified — removing from gallery…";
    case "deleted":
      return "Removed from gallery";
    case "manual-remove":
      return "Uploaded & verified — remove from gallery manually";
    case "error":
      return "Error";
    default:
      return status;
  }
}

const toggleRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
} as const;

function nativeStatusToFileStatus(item: NativeUploadItem): FileStatus {
  switch (item.status) {
    case "pending":
      return "queued";
    case "hashing":
    case "uploading":
    case "done":
      return item.status;
    default:
      return "error";
  }
}

function nativeDoneMessage(item: NativeUploadItem): string {
  const size = item.remoteSize || item.size;
  return `${item.fileName || item.name} · ${formatBytes(size)}${
    item.duplicate ? " (already on Hub)" : ""
  }`;
}

function mediaItemsToQueue(items: PhotoDumpMediaItem[]): QueueItem[] {
  return items.map((item) => ({
    id: nextQueueId(item.name),
    name: item.name,
    size: item.size,
    mimeType: item.mimeType || "application/octet-stream",
    contentUri: item.uri,
    selected: true,
    status: "pending" as const,
  }));
}

/** WebView-safe preview URL for MediaStore / document URIs. */
function galleryThumbSrc(contentUri?: string, file?: File): string | null {
  if (contentUri?.trim()) {
    try {
      return Capacitor.convertFileSrc(contentUri.trim());
    } catch {
      return null;
    }
  }
  if (file) {
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }
  return null;
}

/** Prefer native MediaStore / video top-frame thumbnail (fixes blank video tiles). */
function GalleryThumb({
  contentUri,
  file,
  isVideo,
}: {
  contentUri?: string;
  file?: File;
  isVideo?: boolean;
}) {
  // Don't seed videos with convertFileSrc — WebView shows a broken-image icon.
  const [src, setSrc] = useState<string | null>(
    isVideo ? null : galleryThumbSrc(contentUri, file),
  );
  const blobUrlRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (contentUri && isPhotoDumpMediaNative()) {
        const url = await readPhotoDumpThumbnailDataUrl(contentUri, 256);
        if (!cancelled && url) {
          setSrc(url);
          return;
        }
      }
      if (cancelled) return;
      if (!isVideo) {
        const next = galleryThumbSrc(contentUri, file);
        if (file && next?.startsWith("blob:")) {
          blobUrlRef.current = next;
        }
        setSrc(next);
      } else if (file) {
        const next = galleryThumbSrc(undefined, file);
        if (next?.startsWith("blob:")) blobUrlRef.current = next;
        setSrc(next);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [contentUri, file, isVideo]);
  if (src) {
    return <img src={src} alt="" loading="lazy" />;
  }
  return (
    <span className="photo-dump-gallery-fallback" aria-hidden>
      {isVideo ? "▶" : "🖼"}
    </span>
  );
}

export function PhotoDumpPanel({
  service,
  onBack,
  onOpenSettings,
  onApiKeyChange,
  onSetupApplied,
  pathHint,
  hubVersion = null,
  sharedItems,
  onSharedItemsConsumed,
}: PhotoDumpPanelProps) {
  const hubUrl = service.url.trim();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshGen = useRef(0);
  const mountedRef = useRef(true);
  const nativeMedia = isPhotoDumpMediaNative();
  const sharedIngestKey = useRef("");

  const [apiKey, setApiKey] = useState(service.apiKey || "");
  const [hubSettings, setHubSettings] = useState<PhotoDumpPublicSettings | null>(
    null,
  );
  const [relativePath, setRelativePath] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [showKeyField, setShowKeyField] = useState(false);
  const [monthValue, setMonthValue] = useState(currentMonthValue);
  const [monthBusy, setMonthBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryBrowseMode, setGalleryBrowseMode] = useState<"months" | "albums">(
    "albums",
  );
  const [galleryAlbums, setGalleryAlbums] = useState<PhotoDumpAlbum[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<PhotoDumpAlbum | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryBrowseItem[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryCursor, setGalleryCursor] = useState<{
    year: number;
    month: number;
  } | null>(null);
  const [galleryHint, setGalleryHint] = useState<string | null>(null);
  const nativeQueue = isNativeUploadQueueAvailable();
  const [uploadSettings, setUploadSettings] = useState<PhotoDumpUploadSettings>(
    DEFAULT_PHOTO_DUMP_UPLOAD_SETTINGS,
  );
  const uploadSettingsRef = useRef(uploadSettings);
  uploadSettingsRef.current = uploadSettings;
  /** Worker has pending / in-flight rows. */
  const [nativeActive, setNativeActive] = useState(false);
  const [nativeProgress, setNativeProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [nativeBytes, setNativeBytes] = useState<{
    id: string;
    sent: number;
    total: number;
  } | null>(null);
  const [autoBackupPending, setAutoBackupPending] = useState(0);
  const finalizingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void releaseScreenWakeLock();
    };
  }, []);

  const applyNativeItem = useCallback((item: NativeUploadItem) => {
    if (!mountedRef.current || item.source === "auto") return;
    const status = nativeStatusToFileStatus(item);
    const message =
      status === "done"
        ? `${nativeDoneMessage(item)}. Verified on Hub.`
        : item.message || undefined;
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.id === item.id);
      if (idx < 0) {
        return [
          ...prev,
          {
            id: item.id,
            name: item.name,
            size: item.size,
            mimeType: item.mimeType || "application/octet-stream",
            contentUri: item.uri,
            selected: false,
            status,
            message,
            remotePath: item.remotePath,
          },
        ];
      }
      const cur = prev[idx]!;
      // Panel-side finalization already moved past "done" — don't regress.
      if (
        cur.status === "deleted" ||
        cur.status === "manual-remove" ||
        cur.status === "kept"
      ) {
        return prev;
      }
      const next = [...prev];
      next[idx] = {
        ...cur,
        status,
        message,
        remotePath: item.remotePath || cur.remotePath,
        selected: status === "error" ? cur.selected : false,
      };
      return next;
    });
  }, []);

  /** Pull the native queue into panel state (remount / after events). */
  const syncFromNative = useCallback(async (): Promise<NativeUploadStatusResult | null> => {
    const st = await getNativeUploadStatus();
    if (!st || !mountedRef.current) return st;
    for (const item of st.items) applyNativeItem(item);
    const manualActive = st.items.some(
      (i) =>
        i.source !== "auto" &&
        (i.status === "pending" || i.status === "hashing" || i.status === "uploading"),
    );
    setAutoBackupPending(
      st.items.filter(
        (i) =>
          i.source === "auto" &&
          (i.status === "pending" || i.status === "hashing" || i.status === "uploading"),
      ).length,
    );
    setNativeActive(manualActive);
    if (!manualActive) {
      setNativeProgress(null);
      setNativeBytes(null);
    }
    return st;
  }, [applyNativeItem]);

  const refresh = useCallback(
    async (path = relativePath, key = apiKey) => {
      const gen = ++refreshGen.current;
      setLoading(true);
      setError(null);
      try {
        if (!hubUrl) {
          if (gen !== refreshGen.current) return;
          setHubSettings(null);
          setFolders([]);
          setError(
            "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port.",
          );
          return;
        }

        const settings = await fetchPhotoDumpSettings(hubUrl, key);
        if (gen !== refreshGen.current) return;
        setHubSettings(settings);
        setRootPath(settings.rootPath || "");

        if (!settings.enabled) {
          setFolders([]);
          setError("Photo dump is disabled on the Hub.");
          return;
        }
        if (!settings.rootPathSet) {
          setFolders([]);
          setError("Hub photo dump root path is not configured.");
          return;
        }
        if (!key.trim()) {
          setFolders([]);
          setShowKeyField(true);
          setMessage(
            "Scan the Hub setup QR or paste the photo dump API key from Hub Settings → Photo dump.",
          );
          return;
        }
        if (!settings.apiKeySet) {
          setFolders([]);
          setError(
            "Hub has no photo dump API key yet. Generate one in Hub Settings → Photo dump, then paste it here.",
          );
          return;
        }

        const list = await listPhotoDumpFolders(hubUrl, key, path);
        if (gen !== refreshGen.current) return;
        setFolders(list.folders);
        setRootPath(list.rootPath || settings.rootPath);
        setRelativePath(list.path || path);
        setMessage(null);
      } catch (err) {
        if (gen !== refreshGen.current) return;
        setFolders([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (gen === refreshGen.current) setLoading(false);
      }
    },
    [hubUrl, apiKey, relativePath],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadPhotoDumpApiKey();
      if (cancelled) return;
      const next = stored || service.apiKey.trim();
      setApiKey(next);
      if (stored && stored !== service.apiKey.trim()) {
        onApiKeyChange?.(stored);
      } else if (!stored && service.apiKey.trim()) {
        await savePhotoDumpApiKey(service.apiKey.trim());
      }
      await refresh("", next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubUrl, service.apiKey]);

  useAndroidBackHandler(() => {
    if (uploading) return true;
    if (galleryOpen) {
      if (activeAlbum) {
        setActiveAlbum(null);
        setGalleryItems([]);
        setGalleryHint(null);
        return true;
      }
      setGalleryOpen(false);
      return true;
    }
    if (relativePath) {
      const parent = parentRelative(relativePath);
      setRelativePath(parent);
      void refresh(parent);
      return true;
    }
    return false;
  });

  const persistKey = async (value: string) => {
    const trimmed = value.trim();
    setApiKey(trimmed);
    await savePhotoDumpApiKey(trimmed);
    onApiKeyChange?.(trimmed);
  };

  const applySetupQr = async (payload: PhotoDumpSetupPayload) => {
    if (onSetupApplied) {
      const applied = await onSetupApplied(payload);
      if (applied === false) {
        setMessage("Setup QR cancelled — nothing changed.");
        return;
      }
    } else {
      await persistKey(payload.key);
    }
    setApiKey(payload.key.trim());
    setShowKeyField(false);
    setMessage(
      payload.token?.trim()
        ? "Setup QR applied — Hub URL, photo dump key, and Hub API token saved."
        : "Setup QR applied — Hub URL and photo dump API key saved.",
    );
  };

  const openFolder = (name: string) => {
    if (uploading) return;
    const next = joinRelative(relativePath, name);
    setRelativePath(next);
    void refresh(next);
  };

  const goUp = () => {
    if (uploading) return;
    const parent = parentRelative(relativePath);
    setRelativePath(parent);
    void refresh(parent);
  };

  const createFolder = async () => {
    const name = newFolderName.trim().replace(/[\\/]+/g, "");
    if (!name || busy || uploading) return;
    setBusy(true);
    setError(null);
    try {
      const path = joinRelative(relativePath, name);
      await createPhotoDumpFolder(hubUrl, apiKey, path);
      setNewFolderName("");
      setMessage(`Created folder ${path}`);
      await refresh(relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enqueueItems = (items: QueueItem[], label: string): QueueItem[] => {
    if (!items.length) {
      setMessage(`No media found${label ? ` ${label}` : ""}.`);
      return [];
    }
    // Native stream path can handle larger files; WebView/base64 path stays capped.
    const enqueueMax = nativeMedia
      ? PHOTO_DUMP_NATIVE_MAX_FILE_BYTES
      : PHOTO_DUMP_UI_MAX_FILE_BYTES;
    const oversize = items.filter((item) => item.size > enqueueMax);
    const allowed = items.filter((item) => item.size <= enqueueMax);
    if (oversize.length && allowed.length === 0) {
      setError(
        `${oversize.length} file${oversize.length === 1 ? "" : "s"} exceed the ${formatBytes(enqueueMax)} phone upload cap${nativeMedia ? "" : " (OOM guard)"}.`,
      );
      return [];
    }
    if (oversize.length) {
      setMessage(
        `Skipped ${oversize.length} file${oversize.length === 1 ? "" : "s"} over ${formatBytes(enqueueMax)}.`,
      );
    }
    let added: QueueItem[] = [];
    setQueue((prev) => {
      const existingUris = new Set(
        prev.map((q) => q.contentUri).filter((u): u is string => Boolean(u)),
      );
      const fresh = allowed.filter(
        (item) => !item.contentUri || !existingUris.has(item.contentUri),
      );
      const skipped = allowed.length - fresh.length;
      added = fresh;
      if (fresh.length === 0) {
        queueMicrotask(() =>
          setMessage(
            oversize.length
              ? `Nothing added (oversize or already queued).`
              : `All ${items.length} item${items.length === 1 ? "" : "s"} already in queue.`,
          ),
        );
        return prev;
      }
      queueMicrotask(() =>
        setMessage(
          skipped > 0
            ? `Added ${fresh.length} (${skipped} already queued)${label}.`
            : `Added ${fresh.length} file${fresh.length === 1 ? "" : "s"}${label}.`,
        ),
      );
      return [...prev, ...fresh];
    });
    return added;
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: QueueItem[] = Array.from(files).map((file) => ({
      id: nextQueueId(file.name),
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      file,
      selected: true,
      status: "pending" as const,
    }));
    enqueueItems(next, "");
  };

  // Android Share sheet (Photos / Gallery → Share → Photo Dump).
  useEffect(() => {
    if (!sharedItems?.length) return;
    const key = sharedItems.map((item) => item.uri).join("|");
    if (!key || key === sharedIngestKey.current) return;
    sharedIngestKey.current = key;
    enqueueItems(mediaItemsToQueue(sharedItems), " from Share");
    onSharedItemsConsumed?.();
    // enqueueItems is stable enough for this one-shot ingest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedItems]);

  const onAddWholeMonth = async () => {
    if (!nativeMedia || monthBusy || uploading) return;
    const parsed = parseMonthValue(monthValue);
    if (!parsed) {
      setError("Pick a valid month (YYYY-MM).");
      return;
    }
    setMonthBusy(true);
    setError(null);
    try {
      const res = await queryPhotoDumpMediaMonth(parsed.year, parsed.month);
      const label = ` for ${formatMonthLabel(parsed.year, parsed.month)}`;
      if (res.items.length >= PHOTO_DUMP_MONTH_WARN_COUNT) {
        const totalBytes = res.items.reduce((sum, i) => sum + (i.size || 0), 0);
        const proceed = window.confirm(
          `This month has ${res.items.length} items (${formatBytes(totalBytes)}). Large dumps can stress phone memory. Continue enqueue?`,
        );
        if (!proceed) {
          setMessage("Month dump cancelled.");
          return;
        }
      }
      enqueueItems(mediaItemsToQueue(res.items), label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMonthBusy(false);
    }
  };

  const mergeGalleryMonth = async (year: number, month: number) => {
    const res = await queryPhotoDumpMediaMonth(year, month);
    setGalleryItems((prev) => {
      const seen = new Set(prev.map((item) => item.uri));
      const next = [...prev];
      for (const item of res.items) {
        const uri = String(item.uri || "").trim();
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        next.push({
          uri,
          name: item.name || uri,
          mimeType: item.mimeType || "application/octet-stream",
          size: item.size || 0,
          year,
          month,
          selected: false,
        });
      }
      next.sort((a, b) => {
        const am = a.year * 12 + a.month;
        const bm = b.year * 12 + b.month;
        if (am !== bm) return bm - am;
        return a.name.localeCompare(b.name);
      });
      return next;
    });
    return res.items.length;
  };

  const openGalleryBrowser = async () => {
    if (!nativeMedia || uploading || galleryBusy) return;
    setGalleryOpen(true);
    setGalleryHint(null);
    setActiveAlbum(null);
    setGalleryItems([]);
    setError(null);
    if (galleryBrowseMode === "albums") {
      await loadGalleryAlbums();
    } else {
      await loadGalleryMonths();
    }
  };

  const loadGalleryAlbums = async () => {
    setGalleryBusy(true);
    setGalleryHint(null);
    try {
      const albums = await listPhotoDumpAlbums();
      setGalleryAlbums(albums);
      setGalleryCursor(null);
      setGalleryHint(
        albums.length
          ? "Pick an album (Camera, Screenshots, …), then circle-select."
          : "No albums found.",
      );
    } catch (err) {
      setGalleryHint(err instanceof Error ? err.message : String(err));
    } finally {
      setGalleryBusy(false);
    }
  };

  const loadGalleryMonths = async () => {
    setGalleryBusy(true);
    setGalleryHint(null);
    try {
      const now = new Date();
      let cursor = { year: now.getFullYear(), month: now.getMonth() + 1 };
      setGalleryItems([]);
      setGalleryAlbums([]);
      setActiveAlbum(null);
      let loaded = 0;
      for (let i = 0; i < 3; i++) {
        loaded += await mergeGalleryMonth(cursor.year, cursor.month);
        cursor = shiftMonth(cursor.year, cursor.month, -1);
      }
      setGalleryCursor(cursor);
      setGalleryHint(
        loaded
          ? "Tap circles to select across months, then Upload selected."
          : "No recent media — try Load older months.",
      );
    } catch (err) {
      setGalleryHint(err instanceof Error ? err.message : String(err));
    } finally {
      setGalleryBusy(false);
    }
  };

  const openGalleryAlbum = async (album: PhotoDumpAlbum) => {
    if (galleryBusy) return;
    setGalleryBusy(true);
    setGalleryHint(null);
    setActiveAlbum(album);
    try {
      const res = await queryPhotoDumpAlbum(album.id);
      const now = new Date();
      const items: GalleryBrowseItem[] = (res.items || []).map((item) => ({
        uri: item.uri,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        selected: false,
      }));
      setGalleryItems(items);
      setGalleryHint(
        items.length
          ? `${album.name} · ${items.length} items — circle-select, then upload.`
          : `${album.name} is empty.`,
      );
    } catch (err) {
      setGalleryHint(err instanceof Error ? err.message : String(err));
      setActiveAlbum(null);
    } finally {
      setGalleryBusy(false);
    }
  };

  const switchGalleryBrowseMode = (mode: "months" | "albums") => {
    if (mode === galleryBrowseMode && !activeAlbum) return;
    setGalleryBrowseMode(mode);
    setActiveAlbum(null);
    setGalleryItems([]);
    setGalleryAlbums([]);
    setGalleryCursor(null);
    if (mode === "albums") void loadGalleryAlbums();
    else void loadGalleryMonths();
  };

  const loadOlderGalleryMonth = async () => {
    if (!galleryCursor || galleryBusy) return;
    setGalleryBusy(true);
    setGalleryHint(null);
    try {
      const count = await mergeGalleryMonth(
        galleryCursor.year,
        galleryCursor.month,
      );
      setGalleryHint(
        count
          ? `Loaded ${formatMonthLabel(galleryCursor.year, galleryCursor.month)} (${count}).`
          : `${formatMonthLabel(galleryCursor.year, galleryCursor.month)} was empty.`,
      );
      setGalleryCursor(
        shiftMonth(galleryCursor.year, galleryCursor.month, -1),
      );
    } catch (err) {
      setGalleryHint(err instanceof Error ? err.message : String(err));
    } finally {
      setGalleryBusy(false);
    }
  };

  const toggleGallerySelected = (uri: string) => {
    setGalleryItems((prev) =>
      prev.map((item) =>
        item.uri === uri ? { ...item, selected: !item.selected } : item,
      ),
    );
  };

  const selectAllGalleryVisible = () => {
    setGalleryItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const deselectAllGallery = () => {
    setGalleryItems((prev) =>
      prev.map((item) => ({ ...item, selected: false })),
    );
  };

  const gallerySelected = useMemo(
    () => galleryItems.filter((item) => item.selected),
    [galleryItems],
  );

  const gallerySections = useMemo(() => {
    if (activeAlbum) {
      return [
        {
          key: `album-${activeAlbum.id}`,
          label: activeAlbum.name,
          items: galleryItems,
        },
      ];
    }
    const map = new Map<string, GalleryBrowseItem[]>();
    for (const item of galleryItems) {
      const key = `${item.year}-${String(item.month).padStart(2, "0")}`;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: formatMonthLabel(items[0].year, items[0].month),
      items,
    }));
  }, [galleryItems, activeAlbum]);

  const addGallerySelectionToQueue = (): QueueItem[] => {
    if (!gallerySelected.length) {
      setGalleryHint("Select at least one photo or video.");
      return [];
    }
    return enqueueItems(
      mediaItemsToQueue(
        gallerySelected.map((item) => ({
          uri: item.uri,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
        })),
      ),
      " from gallery browser",
    );
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    if (!mountedRef.current) return;
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const selectable = useMemo(
    () => queue.filter((q) => q.status === "pending" || q.status === "error"),
    [queue],
  );
  const failedItems = useMemo(
    () => queue.filter((q) => q.status === "error"),
    [queue],
  );
  const selectedUploadable = useMemo(
    () => selectable.filter((q) => q.selected),
    [selectable],
  );
  const hubVersionWarn = useMemo(
    () => photoDumpHubVersionWarning(hubVersion),
    [hubVersion],
  );
  const allSelectableSelected =
    selectable.length > 0 && selectable.every((q) => q.selected);

  const selectAllPending = () => {
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "pending" || q.status === "error"
          ? { ...q, selected: true }
          : q,
      ),
    );
  };

  const deselectAllPending = () => {
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "pending" || q.status === "error"
          ? { ...q, selected: false }
          : q,
      ),
    );
  };

  const toggleSelected = (id: string) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id && (q.status === "pending" || q.status === "error")
          ? { ...q, selected: !q.selected }
          : q,
      ),
    );
  };

  const loadBytes = async (
    item: QueueItem,
  ): Promise<{ bytes: ArrayBuffer; base64?: string }> => {
    if (item.size > PHOTO_DUMP_UI_MAX_FILE_BYTES) {
      throw new Error(
        `File exceeds phone upload cap (${formatBytes(PHOTO_DUMP_UI_MAX_FILE_BYTES)}).`,
      );
    }
    if (item.contentUri && nativeMedia) {
      // Legacy path only — prefer hashUri + uploadPhotoDumpFromUri.
      const { base64ToArrayBuffer } = await import("./photoDumpMedia");
      const read = await readPhotoDumpMediaBase64(item.contentUri);
      const bytes = base64ToArrayBuffer(read.base64);
      return { bytes, base64: read.base64 };
    }
    if (item.file) {
      return { bytes: await item.file.arrayBuffer() };
    }
    throw new Error("No file bytes available for this queue item.");
  };

  /**
   * After Hub verification: one Android delete prompt for all originals, or mark
   * them kept when "Keep originals" is on. Returns how many were deleted.
   */
  const finishVerified = async (
    verified: { id: string; contentUri: string; baseMsg: string }[],
  ): Promise<number> => {
    if (!verified.length || !nativeMedia || !mountedRef.current) return 0;
    if (uploadSettingsRef.current.keepOriginals) {
      for (const item of verified) {
        updateItem(item.id, {
          status: "kept",
          message: `${item.baseMsg}. Verified on Hub — original kept on phone.`,
        });
      }
      return 0;
    }
    let deletedCount = 0;
    setMessage(
      `Uploaded & verified ${verified.length} file${
        verified.length === 1 ? "" : "s"
      }. Android will ask to remove originals — tap Allow (or Deny to keep them on the phone).`,
    );
    for (const item of verified) {
      updateItem(item.id, {
        status: "done",
        message: `${item.baseMsg}. Waiting for delete permission…`,
      });
    }
    const del = await deletePhotoDumpMediaUris(verified.map((v) => v.contentUri));
    if (del.deleted) {
      deletedCount = del.deletedCount ?? verified.length;
      for (const item of verified) {
        updateItem(item.id, {
          status: "deleted",
          message: `${item.baseMsg}. Removed from gallery.`,
        });
      }
    } else {
      // Fall back to per-file attempts (some may still succeed).
      for (const item of verified) {
        const one = await deletePhotoDumpMediaUri(item.contentUri);
        if (one.deleted) {
          deletedCount += 1;
          updateItem(item.id, {
            status: "deleted",
            message: `${item.baseMsg}. Removed from gallery.`,
          });
        } else {
          updateItem(item.id, {
            status: "manual-remove",
            message: `${item.baseMsg}. Could not delete gallery original${
              one.message || del.message ? `: ${one.message || del.message}` : ""
            }. Remove from Photos manually.`,
          });
        }
      }
    }
    return deletedCount;
  };

  /**
   * Native queue drained: run the single delete prompt for everything the worker
   * verified, then drop those rows from the native store.
   */
  const finalizeNativeDone = async () => {
    if (finalizingRef.current || !mountedRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return; // retried on visibilitychange — the system delete dialog needs the foreground
    }
    finalizingRef.current = true;
    try {
      const st = await syncFromNative();
      if (!st || !mountedRef.current) return;
      const manual = st.items.filter((i) => i.source !== "auto");
      if (
        manual.some(
          (i) =>
            i.status === "pending" || i.status === "hashing" || i.status === "uploading",
        )
      ) {
        return;
      }
      const done = manual.filter((i) => i.status === "done");
      const failed = manual.filter(
        (i) => i.status === "error" || i.status === "cancelled",
      ).length;
      if (!done.length) {
        if (failed) {
          setMessage(
            `${failed} background upload${failed === 1 ? "" : "s"} failed — phone copies kept. Tap Retry failed.`,
          );
        }
        return;
      }
      const deleted = await finishVerified(
        done.map((i) => ({
          id: i.id,
          contentUri: i.uri,
          baseMsg: nativeDoneMessage(i),
        })),
      );
      await clearNativeUploads(done.map((i) => i.id));
      if (!mountedRef.current) return;
      const parts = [
        failed === 0
          ? `Uploaded & verified ${done.length} file${done.length === 1 ? "" : "s"} in the background`
          : `Background upload: ${done.length} verified, ${failed} failed (phone copies kept on errors)`,
      ];
      if (deleted > 0) parts.push(`${deleted} removed from gallery`);
      else if (uploadSettingsRef.current.keepOriginals) parts.push("originals kept on phone");
      if (failed > 0) parts.push("Tap Retry on failed items (or Retry failed)");
      setMessage(parts.join(". ") + ".");
    } finally {
      finalizingRef.current = false;
    }
  };
  const finalizeNativeDoneRef = useRef(finalizeNativeDone);
  finalizeNativeDoneRef.current = finalizeNativeDone;

  /** Android: hand items to the WorkManager queue — survives leaving the panel / app. */
  const runNativeEnqueue = async (pending: QueueItem[]) => {
    let config: { url: string; headers: Record<string, string> };
    try {
      config = buildPhotoDumpUploadConfig(hubUrl, apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const nativeMax =
      hubSettings?.maxFileBytes && hubSettings.maxFileBytes > 0
        ? Math.min(hubSettings.maxFileBytes, PHOTO_DUMP_NATIVE_MAX_FILE_BYTES)
        : PHOTO_DUMP_NATIVE_MAX_FILE_BYTES;
    const tooBig = pending.filter((q) => q.size > nativeMax);
    for (const item of tooBig) {
      updateItem(item.id, {
        status: "error",
        message: `File exceeds upload cap (${formatBytes(nativeMax)}; size ${formatBytes(item.size)}).`,
      });
    }
    const ok = pending.filter((q) => q.size <= nativeMax && q.contentUri);
    if (!ok.length) return;
    setError(null);
    for (const item of ok) {
      updateItem(item.id, { status: "queued", message: undefined, selected: false });
    }
    try {
      const { wifiOnly, chargingOnly } = uploadSettingsRef.current;
      await enqueueNativeUploads({
        url: config.url,
        headers: config.headers,
        folder: relativePath,
        items: ok.map((q) => ({
          id: q.id,
          uri: q.contentUri!,
          name: q.name,
          size: q.size,
          mimeType: q.mimeType,
        })),
        options: { wifiOnly, chargingOnly },
      });
      setNativeActive(true);
      const waits = [
        wifiOnly ? "Wi‑Fi" : "",
        chargingOnly ? "charging" : "",
      ].filter(Boolean);
      setMessage(
        `Queued ${ok.length} file${ok.length === 1 ? "" : "s"} for background upload${
          waits.length ? ` (waits for ${waits.join(" + ")})` : ""
        }. You can leave this screen or close the app.`,
      );
      void syncFromNative();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const item of ok) {
        updateItem(item.id, { status: "error", message: msg });
      }
      setError(`Could not start background upload: ${msg}`);
    }
  };

  // Load background-upload toggles once.
  useEffect(() => {
    let cancelled = false;
    void loadPhotoDumpUploadSettings().then((s) => {
      if (cancelled) return;
      uploadSettingsRef.current = s;
      setUploadSettings(s);
      void setNativeUploadOptions({
        wifiOnly: s.wifiOnly,
        chargingOnly: s.chargingOnly,
        autoBackup: s.autoBackup,
        autoFolder: s.autoFolder,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the native uploader's Hub endpoint + auth fresh (auto-backup reuses it).
  useEffect(() => {
    if (!nativeQueue || !hubUrl || !apiKey.trim()) return;
    try {
      const { url, headers } = buildPhotoDumpUploadConfig(hubUrl, apiKey);
      void setNativeUploadOptions({ url, headers });
    } catch {
      // URL/key invalid — enqueue will surface the error
    }
  }, [nativeQueue, hubUrl, apiKey]);

  // Live worker events + resync on (re)mount.
  useEffect(() => {
    if (!nativeQueue) return;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    const track = (h: { remove: () => Promise<void> } | null) => {
      if (!h) return;
      if (disposed) void h.remove();
      else handles.push(h);
    };
    void addNativeUploadListener("uploadItem", (ev) => {
      if (ev?.item) applyNativeItem(ev.item);
    }).then(track);
    void addNativeUploadListener("uploadProgress", (ev) => {
      if (!mountedRef.current || !ev) return;
      setNativeActive(true);
      setNativeProgress({
        current: ev.current ?? 0,
        total: ev.runTotal ?? 0,
        label: ev.label || "Uploading…",
      });
    }).then(track);
    void addNativeUploadListener("uploadBytes", (ev) => {
      if (!mountedRef.current || !ev) return;
      setNativeBytes({ id: ev.id, sent: ev.bytesSent, total: ev.bytesTotal });
    }).then(track);
    void addNativeUploadListener("uploadComplete", () => {
      if (!mountedRef.current) return;
      void finalizeNativeDoneRef.current();
    }).then(track);

    void finalizeNativeDoneRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void finalizeNativeDoneRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      for (const h of handles) void h.remove();
    };
  }, [nativeQueue, applyNativeItem]);

  const runUpload = async (opts?: {
    forceAllPending?: boolean;
    /** Upload these items now (avoids stale React queue after enqueue). */
    items?: QueueItem[];
  }) => {
    if (uploading) return;
    const pending = opts?.items?.length
      ? opts.items.filter(
          (q) => q.status === "pending" || q.status === "error",
        )
      : queue.filter(
          (q) =>
            (q.status === "pending" || q.status === "error") &&
            (opts?.forceAllPending || q.selected),
        );
    if (!pending.length) {
      setMessage(
        selectable.length
          ? "Nothing selected — tap Select all or check items to upload."
          : "Nothing to upload — pick photos/videos first.",
      );
      return;
    }
    if (!apiKey.trim()) {
      setShowKeyField(true);
      setError("Photo dump API key required before upload.");
      return;
    }

    if (nativeQueue && pending.every((q) => q.contentUri)) {
      await runNativeEnqueue(pending);
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: pending.length, label: "Starting…" });
    setError(null);
    setMessage(null);
    await acquireScreenWakeLock();
    await startPhotoDumpSyncNotify({
      text: `Starting ${pending.length} file${pending.length === 1 ? "" : "s"}…`,
      current: 0,
      total: pending.length,
    });

    try {
    const folderAtStart = relativePath;
    let okCount = 0;
    let failCount = 0;
    let processed = 0;
    const verifiedForDelete: { id: string; contentUri: string; baseMsg: string }[] =
      [];
    const nativeMax =
      hubSettings?.maxFileBytes && hubSettings.maxFileBytes > 0
        ? Math.min(hubSettings.maxFileBytes, PHOTO_DUMP_NATIVE_MAX_FILE_BYTES)
        : PHOTO_DUMP_NATIVE_MAX_FILE_BYTES;

    for (const item of pending) {
      if (!mountedRef.current) break;
      try {
        updateItem(item.id, { status: "hashing", message: undefined });
        setUploadProgress({
          current: processed,
          total: pending.length,
          label: `Hashing ${item.name}`,
        });

        let result;
        if (item.contentUri && nativeMedia) {
          // Stream hash + upload in native code — never load full file into WebView.
          const hashed = await hashPhotoDumpMediaUri(item.contentUri);
          const size = hashed.size || item.size;
          if (size > nativeMax) {
            throw new Error(
              `File exceeds upload cap (${formatBytes(nativeMax)}; size ${formatBytes(size)}).`,
            );
          }
          updateItem(item.id, { status: "uploading" });
          setUploadProgress({
            current: processed,
            total: pending.length,
            label: `Uploading ${item.name}`,
          });
          result = await uploadPhotoDumpFromUri(hubUrl, apiKey, {
            uri: item.contentUri,
            fileName: item.name || hashed.name,
            relativeFolder: folderAtStart,
            size,
            sha256: hashed.sha256,
          });
        } else {
          const loaded = await loadBytes(item);
          let bytes: ArrayBuffer | undefined = loaded.bytes;
          if (bytes.byteLength > PHOTO_DUMP_UI_MAX_FILE_BYTES) {
            throw new Error(
              `File exceeds phone upload cap (${formatBytes(PHOTO_DUMP_UI_MAX_FILE_BYTES)}; MediaStore size was ${formatBytes(item.size)}).`,
            );
          }
          if (
            hubSettings?.maxFileBytes &&
            bytes.byteLength > hubSettings.maxFileBytes
          ) {
            throw new Error(
              `File exceeds Hub max size (${formatBytes(hubSettings.maxFileBytes)}).`,
            );
          }
          const hash = await sha256Hex(bytes);
          updateItem(item.id, { status: "uploading" });
          setUploadProgress({
            current: processed,
            total: pending.length,
            label: `Uploading ${item.name}`,
          });
          result = await uploadPhotoDumpFile(hubUrl, apiKey, {
            fileName: item.name,
            relativeFolder: folderAtStart,
            bytes,
            base64: loaded.base64,
            size: bytes.byteLength,
            sha256: hash,
          });
          bytes = undefined;
        }

        const dupNote = result.duplicate ? " (already on Hub)" : "";
        const baseMsg = `${result.fileName} · ${formatBytes(result.size)}${dupNote}`;

        if (item.contentUri && nativeMedia) {
          verifiedForDelete.push({
            id: item.id,
            contentUri: item.contentUri,
            baseMsg,
          });
          updateItem(item.id, {
            status: "done",
            remotePath: result.path,
            message: `${baseMsg}. Verified on Hub.`,
          });
        } else {
          updateItem(item.id, {
            status: "manual-remove",
            remotePath: result.path,
            message: `${baseMsg}. No gallery URI — remove from Photos manually.`,
          });
        }
        okCount += 1;
      } catch (err) {
        failCount += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[photoDump] upload failed: ${item.name} — ${msg}`);
        updateItem(item.id, {
          status: "error",
          message: msg,
        });
      } finally {
        processed += 1;
        setUploadProgress({
          current: processed,
          total: pending.length,
          label:
            processed >= pending.length
              ? "Uploads finished…"
              : `Uploaded ${processed}/${pending.length}`,
        });
        void updatePhotoDumpSyncNotify({
          text:
            processed >= pending.length
              ? "Finishing…"
              : `Uploading ${processed}/${pending.length}`,
          current: processed,
          total: pending.length,
        });
        // Yield so UI/GC can breathe between large files.
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    let deletedCount = 0;
    if (verifiedForDelete.length > 0 && nativeMedia && mountedRef.current) {
      if (!uploadSettingsRef.current.keepOriginals) {
        setUploadProgress({
          current: pending.length,
          total: pending.length,
          label: `Waiting for Android delete permission (${verifiedForDelete.length} verified)…`,
        });
      }
      deletedCount = await finishVerified(verifiedForDelete);
    }

    if (mountedRef.current) {
      setUploadProgress(null);
      const parts: string[] = [];
      if (failCount === 0) {
        parts.push(
          `Uploaded & verified ${okCount} file${okCount === 1 ? "" : "s"}`,
        );
      } else {
        parts.push(
          `Done: ${okCount} verified, ${failCount} failed (phone copies kept on errors)`,
        );
      }
      if (deletedCount > 0) {
        parts.push(`${deletedCount} removed from gallery`);
      } else if (
        verifiedForDelete.length > 0 &&
        uploadSettingsRef.current.keepOriginals
      ) {
        parts.push("originals kept on phone");
      } else if (verifiedForDelete.length > 0) {
        parts.push(
          "gallery delete needs Android confirmation — tap Allow if prompted, or remove leftovers manually",
        );
      }
      if (failCount > 0) {
        parts.push(`Tap Retry on failed items (or Retry failed)`);
      }
      setMessage(parts.join(". ") + ".");
    }
    } finally {
      await stopPhotoDumpSyncNotify();
      await releaseScreenWakeLock();
      if (mountedRef.current) {
        setUploading(false);
      }
    }
  };

  const retryFailed = () => {
    if (uploading || failedItems.length === 0) return;
    void runUpload({ items: failedItems });
  };

  const retryOne = (id: string) => {
    if (uploading) return;
    const item = queue.find((q) => q.id === id && q.status === "error");
    if (!item) return;
    void runUpload({ items: [item] });
  };

  const clearFinished = () => {
    setQueue((prev) =>
      prev.filter(
        (q) =>
          q.status !== "manual-remove" &&
          q.status !== "deleted" &&
          q.status !== "kept",
      ),
    );
  };

  const cancelBackgroundUploads = async () => {
    const n = await cancelNativeUploads();
    await syncFromNative();
    setMessage(
      n > 0
        ? `Cancelled ${n} background upload${n === 1 ? "" : "s"} — phone copies kept. Retry anytime.`
        : "Nothing left to cancel.",
    );
    void finalizeNativeDone();
  };

  const updateUploadSettings = (patch: Partial<PhotoDumpUploadSettings>) => {
    const next = { ...uploadSettingsRef.current, ...patch };
    if (patch.autoBackup === true && !uploadSettingsRef.current.autoBackup) {
      if (!apiKey.trim() || !hubUrl) {
        setError("Set the Hub URL and photo dump API key before enabling auto-backup.");
        return;
      }
      next.autoFolder = relativePath;
      // Prompt for gallery access now; the periodic worker can't ask.
      void listPhotoDumpAlbums().catch(() => undefined);
    }
    uploadSettingsRef.current = next;
    setUploadSettings(next);
    void savePhotoDumpUploadSettings(next);
    void setNativeUploadOptions({
      wifiOnly: next.wifiOnly,
      chargingOnly: next.chargingOnly,
      autoBackup: next.autoBackup,
      autoFolder: next.autoFolder,
    });
  };

  const runUploadAll = () => {
    if (uploading || selectable.length === 0) return;
    selectAllPending();
    voidMicrotaskUploadAll();
  };

  const voidMicrotaskUploadAll = () => {
    queueMicrotask(() => {
      void runUpload({ forceAllPending: true });
    });
  };

  const uploadGallerySelection = () => {
    const added = addGallerySelectionToQueue();
    if (!added.length) return;
    setGalleryOpen(false);
    // Pass the just-added items — do not wait for React queue state to flush.
    void runUpload({ items: added });
  };

  const breadcrumb = relativePath
    ? relativePath.split("/").filter(Boolean)
    : [];

  const navLocked = uploading || galleryOpen;

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          disabled={navLocked}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="photo-dump" color={service.color} size={22} />
          Photo Dump
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void refresh(relativePath)}
          disabled={navLocked}
          aria-label="Refresh"
        >
          ↻
        </button>
      </header>

      <div className="luna-subheader">
        <strong>{rootPath || "Hub photo dump"}</strong>
        <span>
          {loading
            ? "…"
            : relativePath
              ? relativePath
              : hubSettings?.enabled
                ? "Root"
                : "Offline"}
        </span>
      </div>
      {pathHint && (
        <p
          className={`dash-path-hint${pathHint === "LAN" ? " is-lan" : ""}`}
          style={{ margin: "0.35rem 1rem 0" }}
        >
          {pathHint === "LAN" ? "Using LAN …" : "Using remote …"}
        </p>
      )}
      {hubVersionWarn && (
        <div className="err banner" style={{ margin: "0.5rem 1rem 0" }}>
          {hubVersionWarn}{" "}
          {hubVersion ? (
            <span className="hint" style={{ padding: 0 }}>
              (Hub {hubVersion})
            </span>
          ) : null}
        </div>
      )}

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {message && !error && <div className="ok banner">{message}</div>}
      {uploading && (
        <div className="ok banner" style={{ margin: "0.5rem 1rem 0" }}>
          Upload in progress — folder navigation locked. Screen stays on while
          syncing.
          {uploadProgress ? (
            <div className="photo-dump-progress" aria-live="polite">
              <div className="photo-dump-progress-meta">
                <strong>
                  {uploadProgress.current}/{uploadProgress.total}
                </strong>
                <span>
                  {uploadProgress.total
                    ? Math.min(
                        100,
                        Math.round(
                          (uploadProgress.current / uploadProgress.total) * 100,
                        ),
                      )
                    : 0}
                  %
                </span>
              </div>
              <div className="photo-dump-progress-track" aria-hidden>
                <div
                  className="photo-dump-progress-fill"
                  style={{
                    width: `${
                      uploadProgress.total
                        ? Math.min(
                            100,
                            (uploadProgress.current / uploadProgress.total) *
                              100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="hint" style={{ padding: "0.35rem 0 0", margin: 0 }}>
                {uploadProgress.label}
              </p>
            </div>
          ) : null}
        </div>
      )}
      {nativeActive && (
        <div className="ok banner" style={{ margin: "0.5rem 1rem 0" }}>
          Uploading in the background — you can browse other folders, leave this
          screen, or close the app.
          {nativeProgress && nativeProgress.total > 0 ? (
            <div className="photo-dump-progress" aria-live="polite">
              <div className="photo-dump-progress-meta">
                <strong>
                  {nativeProgress.current}/{nativeProgress.total}
                </strong>
                <span>
                  {Math.min(
                    100,
                    Math.round((nativeProgress.current / nativeProgress.total) * 100),
                  )}
                  %
                </span>
              </div>
              <div className="photo-dump-progress-track" aria-hidden>
                <div
                  className="photo-dump-progress-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      (nativeProgress.current / nativeProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
              <p className="hint" style={{ padding: "0.35rem 0 0", margin: 0 }}>
                {nativeProgress.label}
                {nativeBytes && nativeBytes.total > 0
                  ? ` · ${formatBytes(nativeBytes.sent)} / ${formatBytes(nativeBytes.total)}`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="hint" style={{ padding: "0.35rem 0 0", margin: 0 }}>
              Waiting to start
              {uploadSettings.wifiOnly || uploadSettings.chargingOnly
                ? ` (needs ${[
                    uploadSettings.wifiOnly ? "Wi‑Fi" : "",
                    uploadSettings.chargingOnly ? "charging" : "",
                  ]
                    .filter(Boolean)
                    .join(" + ")})`
                : ""}
              …
            </p>
          )}
          <button
            type="button"
            className="btn chip"
            style={{ marginTop: "0.4rem" }}
            onClick={() => void cancelBackgroundUploads()}
          >
            Cancel background uploads
          </button>
        </div>
      )}
      {loading && <p className="hint">Loading folders from Arrs Hub…</p>}

      {!loading && (
        <div className="photo-dump-body">
          <div className="photo-dump-toolbar">
            <button
              type="button"
              className="btn chip"
              disabled={!relativePath || busy || navLocked}
              onClick={goUp}
            >
              ↑ Up
            </button>
            <button
              type="button"
              className="btn chip"
              onClick={() => setShowKeyField((v) => !v)}
            >
              {showKeyField ? "Hide key" : "API key"}
            </button>
            {onSetupApplied && (
              <PhotoDumpQrScan onPayload={applySetupQr} />
            )}
          </div>

          {showKeyField && (
            <label className="field">
              <span>Photo dump API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder="Paste from Hub Settings → Photo dump"
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={(e) => void persistKey(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                style={{ marginTop: "0.5rem" }}
                onClick={() => {
                  void persistKey(apiKey).then(() =>
                    refresh(relativePath, apiKey),
                  );
                }}
              >
                Save key &amp; reload
              </button>
            </label>
          )}

          <div className="photo-dump-crumbs" aria-label="Folder path">
            <button
              type="button"
              className="photo-dump-crumb"
              disabled={navLocked}
              onClick={() => {
                if (navLocked) return;
                setRelativePath("");
                void refresh("");
              }}
            >
              root
            </button>
            {breadcrumb.map((part, i) => {
              const path = breadcrumb.slice(0, i + 1).join("/");
              return (
                <span key={path} className="photo-dump-crumb-wrap">
                  <span className="photo-dump-crumb-sep">/</span>
                  <button
                    type="button"
                    className="photo-dump-crumb"
                    disabled={navLocked}
                    onClick={() => {
                      if (navLocked) return;
                      setRelativePath(path);
                      void refresh(path);
                    }}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="photo-dump-folder-list">
            {folders.length === 0 && !error && (
              <p className="hint" style={{ padding: "0.35rem 0" }}>
                No subfolders here — create one or upload into this folder.
              </p>
            )}
            {folders.map((name) => (
              <button
                key={name}
                type="button"
                className="photo-dump-folder-row"
                disabled={navLocked}
                onClick={() => openFolder(name)}
              >
                <span className="photo-dump-folder-icon" aria-hidden>
                  /
                </span>
                <strong>{name}</strong>
                <span className="photo-dump-folder-chevron">›</span>
              </button>
            ))}
          </div>

          <div className="photo-dump-create">
            <label className="field" style={{ flex: 1, margin: 0 }}>
              <span>New folder</span>
              <input
                value={newFolderName}
                placeholder="e.g. Vacation2026"
                disabled={navLocked}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createFolder();
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={
                busy || navLocked || !newFolderName.trim() || !apiKey.trim()
              }
              onClick={() => void createFolder()}
            >
              Create
            </button>
          </div>

          <div className="photo-dump-pick">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {nativeMedia ? (
              <button
                type="button"
                className="btn primary"
                disabled={navLocked || galleryBusy}
                onClick={() => void openGalleryBrowser()}
              >
                Browse gallery
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={navLocked}
                onClick={() => fileInputRef.current?.click()}
              >
                Pick photos / videos
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={uploading || selectedUploadable.length === 0}
              onClick={() => void runUpload()}
            >
              {uploading
                ? "Uploading…"
                : selectedUploadable.length
                  ? `Upload selected (${selectedUploadable.length})`
                  : "Upload selected"}
            </button>
            {selectable.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={uploading}
                onClick={runUploadAll}
              >
                Upload all ({selectable.length})
              </button>
            )}
            {queue.some(
              (q) =>
                q.status === "manual-remove" ||
                q.status === "deleted" ||
                q.status === "kept",
            ) && (
              <button
                type="button"
                className="btn chip"
                disabled={navLocked}
                onClick={clearFinished}
              >
                Clear finished
              </button>
            )}
          </div>

          {nativeMedia && (
            <details className="photo-dump-month-details">
              <summary>Add entire month (bulk)</summary>
              <div
                className="photo-dump-create"
                style={{ marginTop: "0.5rem", alignItems: "flex-end" }}
              >
                <label className="field" style={{ flex: 1, margin: 0 }}>
                  <span>Month</span>
                  <input
                    type="month"
                    value={monthValue}
                    disabled={navLocked || monthBusy}
                    onChange={(e) => setMonthValue(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={navLocked || monthBusy || !monthValue}
                  onClick={() => void onAddWholeMonth()}
                >
                  {monthBusy ? "Scanning…" : "Add month"}
                </button>
              </div>
              <p className="hint" style={{ padding: "0.35rem 0 0" }}>
                Prefer Browse gallery to circle-select across months. Whole-month
                dump is for dumping everything from one month at once.
              </p>
            </details>
          )}

          {nativeQueue && (
            <details className="photo-dump-month-details">
              <summary>Background upload settings</summary>
              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
                <label style={toggleRowStyle}>
                  <input
                    type="checkbox"
                    checked={uploadSettings.wifiOnly}
                    onChange={(e) => updateUploadSettings({ wifiOnly: e.target.checked })}
                  />{" "}
                  Wi‑Fi only (wait for an unmetered network)
                </label>
                <label style={toggleRowStyle}>
                  <input
                    type="checkbox"
                    checked={uploadSettings.chargingOnly}
                    onChange={(e) =>
                      updateUploadSettings({ chargingOnly: e.target.checked })
                    }
                  />{" "}
                  Only while charging
                </label>
                <label style={toggleRowStyle}>
                  <input
                    type="checkbox"
                    checked={uploadSettings.autoBackup}
                    onChange={(e) =>
                      updateUploadSettings({ autoBackup: e.target.checked })
                    }
                  />{" "}
                  Auto-backup new camera photos &amp; videos
                </label>
                {uploadSettings.autoBackup ? (
                  <p className="hint" style={{ padding: "0 0 0 1.4rem", margin: 0 }}>
                    Every ~15 min, new camera media goes to{" "}
                    <code>/{uploadSettings.autoFolder || ""}</code>. Originals are
                    never deleted by auto-backup.
                    {autoBackupPending > 0
                      ? ` ${autoBackupPending} waiting to upload.`
                      : ""}{" "}
                    <button
                      type="button"
                      className="btn chip"
                      disabled={uploadSettings.autoFolder === relativePath}
                      onClick={() => updateUploadSettings({ autoFolder: relativePath })}
                    >
                      Use current folder
                    </button>
                  </p>
                ) : null}
                <label style={toggleRowStyle}>
                  <input
                    type="checkbox"
                    checked={uploadSettings.keepOriginals}
                    onChange={(e) =>
                      updateUploadSettings({ keepOriginals: e.target.checked })
                    }
                  />{" "}
                  Keep originals (skip the remove-from-gallery prompt)
                </label>
              </div>
            </details>
          )}

          {selectable.length > 0 && (
            <div className="photo-dump-toolbar" style={{ marginTop: "0.35rem" }}>
              <button
                type="button"
                className="btn chip"
                disabled={navLocked || allSelectableSelected}
                onClick={selectAllPending}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={navLocked || selectedUploadable.length === 0}
                onClick={deselectAllPending}
              >
                Deselect all
              </button>
              {failedItems.length > 0 ? (
                <button
                  type="button"
                  className="btn chip"
                  disabled={navLocked}
                  onClick={retryFailed}
                >
                  Retry failed ({failedItems.length})
                </button>
              ) : null}
              <span className="hint" style={{ padding: 0 }}>
                {selectedUploadable.length}/{selectable.length} selected
              </span>
            </div>
          )}

          <p className="hint" style={{ paddingTop: 0 }}>
            {nativeMedia
              ? "Browse gallery for Photos-style circle selection, or Share from Google Photos / Gallery (Share → Photo Dump). After Hub verifies, Android asks once to remove originals (Allow)."
              : "Files upload to the Hub folder above. Phone copies stay until you remove them from the gallery (web has no MediaStore delete)."}{" "}
            Hub must return <code>verified: true</code> with matching SHA-256.
          </p>

          {selectable.length > 0 && (
            <div
              className="photo-dump-gallery"
              role="group"
              aria-label="Gallery selection"
            >
              {selectable.map((item) => {
                const isVideo = (item.mimeType || "").startsWith("video/");
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`photo-dump-gallery-cell${
                      item.selected ? " selected" : ""
                    }`}
                    disabled={navLocked}
                    onClick={() => toggleSelected(item.id)}
                    aria-pressed={item.selected}
                    aria-label={`${item.selected ? "Deselect" : "Select"} ${item.name}`}
                  >
                    <GalleryThumb
                      contentUri={item.contentUri}
                      file={item.file}
                      isVideo={isVideo}
                    />
                    {isVideo ? (
                      <span className="photo-dump-gallery-video" aria-hidden>
                        ▶
                      </span>
                    ) : null}
                    <span
                      className={`photo-dump-gallery-check${
                        item.selected ? " on" : ""
                      }`}
                      aria-hidden
                    >
                      {item.selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {queue.length > 0 && (
            <ul className="photo-dump-queue">
              {queue.map((item) => {
                if (item.status === "pending") return null;
                return (
                  <li
                    key={item.id}
                    className={`photo-dump-queue-item status-${item.status}`}
                  >
                    <div className="photo-dump-queue-main">
                      <strong>{item.name}</strong>
                      <span className="hint" style={{ padding: 0 }}>
                        {formatBytes(item.size)} · {statusLabel(item.status)}
                      </span>
                      {item.status === "error" ? (
                        <button
                          type="button"
                          className="btn chip"
                          disabled={navLocked}
                          onClick={() => retryOne(item.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                    {item.message && (
                      <p className="photo-dump-queue-msg">{item.message}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {galleryOpen && (
        <div className="photo-dump-gallery-overlay" role="dialog" aria-modal="true">
          <div className="photo-dump-gallery-sheet">
            <div className="photo-dump-gallery-head">
              <strong>
                {activeAlbum
                  ? activeAlbum.name
                  : galleryBrowseMode === "albums"
                    ? "Albums"
                    : "By month"}
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  if (activeAlbum) {
                    setActiveAlbum(null);
                    setGalleryItems([]);
                    setGalleryHint(null);
                    return;
                  }
                  setGalleryOpen(false);
                }}
                aria-label={activeAlbum ? "Back to albums" : "Close gallery"}
              >
                {activeAlbum ? "←" : "✕"}
              </button>
            </div>
            {!activeAlbum ? (
              <div className="photo-dump-toolbar" style={{ marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className={`btn chip${galleryBrowseMode === "albums" ? " primary" : ""}`}
                  disabled={galleryBusy}
                  onClick={() => switchGalleryBrowseMode("albums")}
                >
                  Albums
                </button>
                <button
                  type="button"
                  className={`btn chip${galleryBrowseMode === "months" ? " primary" : ""}`}
                  disabled={galleryBusy}
                  onClick={() => switchGalleryBrowseMode("months")}
                >
                  By month
                </button>
              </div>
            ) : null}
            <p className="hint" style={{ padding: "0 0 0.5rem" }}>
              {activeAlbum
                ? "Circle-select in this album, then upload."
                : galleryBrowseMode === "albums"
                  ? "Camera, Screenshots, and other folders from your gallery."
                  : "Circle-select across months like Photos. Load older months as needed."}
            </p>
            {galleryBrowseMode === "albums" && !activeAlbum ? (
              <>
                {galleryHint && (
                  <p className="hint" style={{ padding: "0 0 0.5rem" }}>
                    {galleryHint}
                  </p>
                )}
                <div className="photo-dump-gallery-scroll">
                  {galleryAlbums.length === 0 && !galleryBusy ? (
                    <p className="hint">No albums loaded yet.</p>
                  ) : null}
                  <ul className="photo-dump-album-list">
                    {galleryAlbums.map((album) => (
                      <li key={album.id}>
                        <button
                          type="button"
                          className="photo-dump-album-row"
                          disabled={galleryBusy}
                          onClick={() => void openGalleryAlbum(album)}
                        >
                          <span className="photo-dump-album-cover" aria-hidden>
                            {album.coverUri ? (
                              <GalleryThumb
                                contentUri={album.coverUri}
                                isVideo={false}
                              />
                            ) : (
                              "📁"
                            )}
                          </span>
                          <span className="photo-dump-album-meta">
                            <strong>{album.name}</strong>
                            <span className="hint" style={{ padding: 0 }}>
                              {album.count} item{album.count === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="photo-dump-toolbar" style={{ marginBottom: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn chip"
                    disabled={galleryBusy || galleryItems.length === 0}
                    onClick={selectAllGalleryVisible}
                  >
                    Select all shown
                  </button>
                  <button
                    type="button"
                    className="btn chip"
                    disabled={galleryBusy || gallerySelected.length === 0}
                    onClick={deselectAllGallery}
                  >
                    Deselect
                  </button>
                  {galleryBrowseMode === "months" && !activeAlbum ? (
                    <button
                      type="button"
                      className="btn chip"
                      disabled={galleryBusy || !galleryCursor}
                      onClick={() => void loadOlderGalleryMonth()}
                    >
                      {galleryBusy ? "Loading…" : "Load older month"}
                    </button>
                  ) : null}
                  <span className="hint" style={{ padding: 0 }}>
                    {gallerySelected.length}/{galleryItems.length} selected
                  </span>
                </div>
                {galleryHint && (
                  <p className="hint" style={{ padding: "0 0 0.5rem" }}>
                    {galleryHint}
                  </p>
                )}
                <div className="photo-dump-gallery-scroll">
                  {gallerySections.length === 0 && !galleryBusy ? (
                    <p className="hint">No media loaded yet.</p>
                  ) : null}
                  {gallerySections.map((section) => (
                    <section key={section.key} className="photo-dump-gallery-section">
                      <h3 className="photo-dump-gallery-section-title">
                        {section.label}
                        <span className="hint" style={{ padding: 0 }}>
                          {" "}
                          · {section.items.length}
                        </span>
                      </h3>
                      <div
                        className="photo-dump-gallery"
                        role="group"
                        aria-label={`Media for ${section.label}`}
                      >
                        {section.items.map((item) => {
                          const isVideo = (item.mimeType || "").startsWith("video/");
                          return (
                            <button
                              key={item.uri}
                              type="button"
                              className={`photo-dump-gallery-cell${
                                item.selected ? " selected" : ""
                              }`}
                              disabled={galleryBusy}
                              onClick={() => toggleGallerySelected(item.uri)}
                              aria-pressed={item.selected}
                              aria-label={`${item.selected ? "Deselect" : "Select"} ${item.name}`}
                            >
                              <GalleryThumb
                                contentUri={item.uri}
                                isVideo={isVideo}
                              />
                              {isVideo ? (
                                <span
                                  className="photo-dump-gallery-video"
                                  aria-hidden
                                >
                                  ▶
                                </span>
                              ) : null}
                              <span
                                className={`photo-dump-gallery-check${
                                  item.selected ? " on" : ""
                                }`}
                                aria-hidden
                              >
                                {item.selected ? "✓" : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="photo-dump-gallery-footer">
                  <button
                    type="button"
                    className="btn"
                    disabled={galleryBusy || gallerySelected.length === 0}
                    onClick={() => {
                      addGallerySelectionToQueue();
                      setGalleryOpen(false);
                    }}
                  >
                    Add to queue ({gallerySelected.length})
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={
                      galleryBusy || gallerySelected.length === 0 || uploading
                    }
                    onClick={uploadGallerySelection}
                  >
                    Upload selected ({gallerySelected.length})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
