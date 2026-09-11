import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAndroidBackHandler } from "./androidBack";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";
import {
  createPhotoDumpFolder,
  fetchPhotoDumpSettings,
  formatBytes,
  listPhotoDumpFolders,
  loadPhotoDumpApiKey,
  savePhotoDumpApiKey,
  sha256Hex,
  uploadPhotoDumpFile,
  type PhotoDumpPublicSettings,
} from "./photoDumpApi";
import {
  base64ToArrayBuffer,
  deletePhotoDumpMediaUri,
  isPhotoDumpMediaNative,
  pickPhotoDumpMedia,
  queryPhotoDumpMediaMonth,
  readPhotoDumpMediaBase64,
  type PhotoDumpMediaItem,
} from "./photoDumpMedia";
import { PhotoDumpQrScan } from "./PhotoDumpQrScan";
import type { PhotoDumpSetupPayload } from "./photoDumpSetupQr";

interface PhotoDumpPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
  /** Persist key onto the photo-dump service so Settings stays in sync. */
  onApiKeyChange?: (apiKey: string) => void;
  /** Apply scanned Hub setup QR (API key + Hub URL). */
  onSetupApplied?: (payload: PhotoDumpSetupPayload) => void | Promise<void>;
  /** Live LAN vs remote path hint while the panel is open. */
  pathHint?: "LAN" | "Remote";
}

type FileStatus =
  | "pending"
  | "hashing"
  | "uploading"
  | "deleted"
  | "manual-remove"
  | "error";

/** Soft cap to avoid OOM on phone — Hub may allow larger; warn/block in UI. */
export const PHOTO_DUMP_UI_MAX_FILE_BYTES = 400 * 1024 * 1024;
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

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "hashing":
      return "Hashing…";
    case "uploading":
      return "Uploading…";
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

export function PhotoDumpPanel({
  service,
  onBack,
  onOpenSettings,
  onApiKeyChange,
  onSetupApplied,
  pathHint,
}: PhotoDumpPanelProps) {
  const hubUrl = service.url.trim();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshGen = useRef(0);
  const mountedRef = useRef(true);
  const nativeMedia = isPhotoDumpMediaNative();

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
  const [showKeyField, setShowKeyField] = useState(false);
  const [monthValue, setMonthValue] = useState(currentMonthValue);
  const [monthBusy, setMonthBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      await onSetupApplied(payload);
    } else {
      await persistKey(payload.key);
    }
    setApiKey(payload.key.trim());
    setShowKeyField(false);
    setMessage("Setup QR applied — Hub URL and API key saved.");
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

  const enqueueItems = (items: QueueItem[], label: string) => {
    if (!items.length) {
      setMessage(`No media found${label ? ` ${label}` : ""}.`);
      return;
    }
    const oversize = items.filter(
      (item) => item.size > PHOTO_DUMP_UI_MAX_FILE_BYTES,
    );
    const allowed = items.filter(
      (item) => item.size <= PHOTO_DUMP_UI_MAX_FILE_BYTES,
    );
    if (oversize.length && allowed.length === 0) {
      setError(
        `${oversize.length} file${oversize.length === 1 ? "" : "s"} exceed the ${formatBytes(PHOTO_DUMP_UI_MAX_FILE_BYTES)} phone upload cap (OOM guard).`,
      );
      return;
    }
    if (oversize.length) {
      setMessage(
        `Skipped ${oversize.length} file${oversize.length === 1 ? "" : "s"} over ${formatBytes(PHOTO_DUMP_UI_MAX_FILE_BYTES)}.`,
      );
    }
    setQueue((prev) => {
      const existingUris = new Set(
        prev.map((q) => q.contentUri).filter((u): u is string => Boolean(u)),
      );
      const fresh = allowed.filter(
        (item) => !item.contentUri || !existingUris.has(item.contentUri),
      );
      const skipped = allowed.length - fresh.length;
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

  const onNativePick = async () => {
    if (uploading) return;
    setError(null);
    try {
      const items = await pickPhotoDumpMedia(true);
      enqueueItems(mediaItemsToQueue(items), " from gallery");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
      const label = ` for ${String(parsed.month).padStart(2, "0")}/${parsed.year}`;
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
  const selectedUploadable = useMemo(
    () => selectable.filter((q) => q.selected),
    [selectable],
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
    setMessage(
      selectable.length
        ? `Selected all ${selectable.length} pending item${selectable.length === 1 ? "" : "s"}.`
        : "Nothing pending to select.",
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
      const read = await readPhotoDumpMediaBase64(item.contentUri);
      // Keep base64 for native upload so we don't re-encode ArrayBuffer→base64.
      const bytes = base64ToArrayBuffer(read.base64);
      return { bytes, base64: read.base64 };
    }
    if (item.file) {
      return { bytes: await item.file.arrayBuffer() };
    }
    throw new Error("No file bytes available for this queue item.");
  };

  const runUpload = async () => {
    if (uploading) return;
    const pending = queue.filter(
      (q) =>
        (q.status === "pending" || q.status === "error") && q.selected,
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

    setUploading(true);
    setError(null);
    setMessage(null);

    const folderAtStart = relativePath;
    let okCount = 0;
    let failCount = 0;
    let deletedCount = 0;

    for (const item of pending) {
      if (!mountedRef.current) break;
      try {
        updateItem(item.id, { status: "hashing", message: undefined });
        const loaded = await loadBytes(item);
        let bytes: ArrayBuffer | undefined = loaded.bytes;
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
        const result = await uploadPhotoDumpFile(hubUrl, apiKey, {
          fileName: item.name,
          relativeFolder: folderAtStart,
          bytes,
          base64: loaded.base64,
          size: item.size || bytes.byteLength,
          sha256: hash,
        });
        // Drop local bytes ASAP after upload call returns.
        bytes = undefined;
        const dupNote = result.duplicate ? " (already on Hub)" : "";
        const baseMsg = `${result.fileName} · ${formatBytes(result.size)}${dupNote}`;

        if (item.contentUri && nativeMedia) {
          const del = await deletePhotoDumpMediaUri(item.contentUri);
          if (del.deleted) {
            deletedCount += 1;
            updateItem(item.id, {
              status: "deleted",
              remotePath: result.path,
              message: `${baseMsg}. Removed from gallery.`,
            });
          } else {
            updateItem(item.id, {
              status: "manual-remove",
              remotePath: result.path,
              message: `${baseMsg}. Could not delete gallery original${
                del.message ? `: ${del.message}` : ""
              }. Remove from Photos manually.`,
            });
          }
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
        updateItem(item.id, {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (mountedRef.current) {
      setUploading(false);
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
        parts.push(
          `${deletedCount} removed from gallery`,
        );
      }
      setMessage(parts.join(". ") + ".");
    }
  };

  const clearFinished = () => {
    setQueue((prev) =>
      prev.filter(
        (q) => q.status !== "manual-remove" && q.status !== "deleted",
      ),
    );
  };

  const breadcrumb = relativePath
    ? relativePath.split("/").filter(Boolean)
    : [];

  const navLocked = uploading;

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
        <p className="hint">
          Upload in progress — folder navigation locked until finished.
        </p>
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
                className="btn"
                disabled={navLocked}
                onClick={() => void onNativePick()}
              >
                Choose from gallery
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={navLocked}
              onClick={() => fileInputRef.current?.click()}
            >
              {nativeMedia ? "Pick files (fallback)" : "Pick photos / videos"}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={uploading || selectedUploadable.length === 0}
              onClick={() => void runUpload()}
            >
              {uploading
                ? "Uploading…"
                : selectedUploadable.length
                  ? `Upload & verify (${selectedUploadable.length})`
                  : "Upload & verify"}
            </button>
            {queue.some(
              (q) => q.status === "manual-remove" || q.status === "deleted",
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
            <div
              className="photo-dump-create"
              style={{ marginTop: "0.5rem", alignItems: "flex-end" }}
            >
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Add whole month…</span>
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
              <span className="hint" style={{ padding: 0 }}>
                {selectedUploadable.length}/{selectable.length} selected
              </span>
            </div>
          )}

          <p className="hint" style={{ paddingTop: 0 }}>
            {nativeMedia
              ? "After Hub verifies (or reports a duplicate SHA), gallery originals are deleted via MediaStore when a content URI is available. Scoped storage may block some deletes — those stay as manual remove."
              : "Files upload to the Hub folder above. Phone copies stay until you remove them from the gallery (web has no MediaStore delete)."}{" "}
            Hub must return <code>verified: true</code> with matching SHA-256.
          </p>

          {queue.length > 0 && (
            <ul className="photo-dump-queue">
              {queue.map((item) => {
                const canSelect =
                  item.status === "pending" || item.status === "error";
                return (
                  <li
                    key={item.id}
                    className={`photo-dump-queue-item status-${item.status}`}
                  >
                    <div className="photo-dump-queue-main">
                      {canSelect ? (
                        <label
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            alignItems: "flex-start",
                            margin: 0,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={navLocked}
                            onChange={() => toggleSelected(item.id)}
                            aria-label={`Select ${item.name}`}
                          />
                          <span>
                            <strong>{item.name}</strong>
                            <span
                              className="hint"
                              style={{ padding: 0, display: "block" }}
                            >
                              {formatBytes(item.size)} ·{" "}
                              {statusLabel(item.status)}
                            </span>
                          </span>
                        </label>
                      ) : (
                        <>
                          <strong>{item.name}</strong>
                          <span className="hint" style={{ padding: 0 }}>
                            {formatBytes(item.size)} · {statusLabel(item.status)}
                          </span>
                        </>
                      )}
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
    </div>
  );
}
