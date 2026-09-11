import { useCallback, useEffect, useRef, useState } from "react";
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
  | "manual-remove"
  | "error";

type QueueItem = {
  id: string;
  file: File;
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

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "hashing":
      return "Hashing…";
    case "uploading":
      return "Uploading…";
    case "manual-remove":
      return "Uploaded & verified — remove from gallery manually";
    case "error":
      return "Error";
    default:
      return status;
  }
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
      // Re-fetch folders once the Preferences key is resolved (may be empty at mount).
      await refresh("", next);
    })();
    return () => {
      cancelled = true;
    };
    // Initial load when hub URL / key identity changes.
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
    // Parent updates service.url / apiKey; the hubUrl effect reloads folders.
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

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: QueueItem[] = Array.from(files).map((file) => ({
      id: nextQueueId(file.name),
      file,
      status: "pending" as const,
    }));
    setQueue((prev) => [...prev, ...next]);
    setMessage(`Added ${next.length} file${next.length === 1 ? "" : "s"}.`);
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    if (!mountedRef.current) return;
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const runUpload = async () => {
    if (uploading) return;
    const pending = queue.filter(
      (q) => q.status === "pending" || q.status === "error",
    );
    if (!pending.length) {
      setMessage("Nothing to upload — pick photos/videos first.");
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

    for (const item of pending) {
      if (!mountedRef.current) break;
      try {
        updateItem(item.id, { status: "hashing", message: undefined });
        const bytes = await item.file.arrayBuffer();
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
          fileName: item.file.name,
          relativeFolder: folderAtStart,
          bytes,
          sha256: hash,
        });
        updateItem(item.id, {
          status: "manual-remove",
          remotePath: result.path,
          message: `${result.fileName} · ${formatBytes(result.size)}. WebView cannot delete gallery originals — remove from Photos manually.`,
        });
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
      setMessage(
        failCount === 0
          ? `Uploaded & verified ${okCount} file${okCount === 1 ? "" : "s"}.`
          : `Done: ${okCount} verified, ${failCount} failed (phone copies kept on errors).`,
      );
    }
  };

  const clearFinished = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "manual-remove"));
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
            <button
              type="button"
              className="btn"
              disabled={navLocked}
              onClick={() => fileInputRef.current?.click()}
            >
              Pick photos / videos
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={
                uploading ||
                !queue.some(
                  (q) => q.status === "pending" || q.status === "error",
                )
              }
              onClick={() => void runUpload()}
            >
              {uploading ? "Uploading…" : "Upload & verify"}
            </button>
            {queue.some((q) => q.status === "manual-remove") && (
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

          <p className="hint" style={{ paddingTop: 0 }}>
            Files upload to the Hub folder above. Phone copies stay until you
            remove them from the gallery (WebView cannot delete MediaStore
            originals). Hub must return <code>verified: true</code> with matching
            size and SHA-256.
          </p>

          {queue.length > 0 && (
            <ul className="photo-dump-queue">
              {queue.map((item) => (
                <li
                  key={item.id}
                  className={`photo-dump-queue-item status-${item.status}`}
                >
                  <div className="photo-dump-queue-main">
                    <strong>{item.file.name}</strong>
                    <span className="hint" style={{ padding: 0 }}>
                      {formatBytes(item.file.size)} · {statusLabel(item.status)}
                    </span>
                  </div>
                  {item.message && (
                    <p className="photo-dump-queue-msg">{item.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
