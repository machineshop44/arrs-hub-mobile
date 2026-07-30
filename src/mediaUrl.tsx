import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
} from "react";
import type { ServiceConfig } from "./services";
import { arrApiVersion } from "./services";

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Lidarr/Readarr serve covers at `/MediaCover/...`; Sonarr/Radarr use `/api/v3/MediaCover/...`. */
export function mediaCoverRoot(service: Pick<ServiceConfig, "id">): string {
  return arrApiVersion(service) === "v1"
    ? "/MediaCover"
    : `/api/${arrApiVersion(service)}/MediaCover`;
}

export function mediaCoverUrl(
  service: ServiceConfig,
  id: number,
  kind: "poster" | "fanart" = "poster",
): string {
  const base = normalizeBase(service.url);
  const key = encodeURIComponent(service.apiKey.trim());
  const root = mediaCoverRoot(service);
  const qs = key ? `?apikey=${key}` : "";
  return `${base}${root}/${id}/${kind}-500.jpg${qs}`;
}

export function albumCoverUrl(service: ServiceConfig, albumId: number): string {
  const base = normalizeBase(service.url);
  const key = encodeURIComponent(service.apiKey.trim());
  const root = mediaCoverRoot(service);
  const qs = key ? `?apikey=${key}` : "";
  return `${base}${root}/Albums/${albumId}/cover-500.jpg${qs}`;
}

export function bookCoverUrl(service: ServiceConfig, bookId: number): string {
  const base = normalizeBase(service.url);
  const key = encodeURIComponent(service.apiKey.trim());
  const root = mediaCoverRoot(service);
  const qs = key ? `?apikey=${key}` : "";
  return `${base}${root}/Books/${bookId}/cover-500.jpg${qs}`;
}

type ArrImageLike = {
  coverType?: unknown;
  url?: unknown;
  remoteUrl?: unknown;
};

/**
 * Prefer HTTPS CDN `remoteUrl` (works in Capacitor https WebView).
 * Fall back to a constructed authenticated MediaCover URL — never the
 * relative `/MediaCover/...` path alone (Sonarr/Readarr often 401 that).
 */
export function pickArrImageUrl(
  _service: ServiceConfig,
  images: unknown,
  coverType: "poster" | "fanart" | "cover",
  fallbackLocal?: string,
): string | undefined {
  const list = Array.isArray(images) ? (images as ArrImageLike[]) : [];
  const want = coverType === "cover" ? "cover" : coverType;
  const match =
    list.find(
      (img) => String(img.coverType || "").toLowerCase() === want,
    ) ||
    (want === "cover"
      ? list.find(
          (img) => String(img.coverType || "").toLowerCase() === "poster",
        )
      : undefined);
  const remote = match?.remoteUrl ? String(match.remoteUrl).trim() : "";
  if (remote.startsWith("http://") || remote.startsWith("https://")) {
    return remote;
  }
  return fallbackLocal;
}

function needsNativeMediaFetch(url: string): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return new URL(url).protocol === "http:";
  } catch {
    return false;
  }
}

const objectUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function bytesToObjectUrl(
  data: ArrayBuffer | string,
  contentType: string,
): string {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    // Capacitor may return binary as base64 when responseType is blob/arraybuffer
    const binary = atob(data.includes(",") ? data.split(",").pop()! : data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new Uint8Array(data);
  }
  const blob = new Blob([bytes], { type: contentType || "image/jpeg" });
  return URL.createObjectURL(blob);
}

/** Resolve http MediaCover / poster URLs via CapacitorHttp so WebView mixed content can't break them. */
export async function resolveMediaDisplayUrl(
  url: string | undefined | null,
): Promise<string | undefined> {
  const src = String(url || "").trim();
  if (!src) return undefined;
  if (!needsNativeMediaFetch(src)) return src;

  const cached = objectUrlCache.get(src);
  if (cached) return cached;

  let pending = inflight.get(src);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await CapacitorHttp.request({
          url: src,
          method: "GET",
          responseType: "arraybuffer",
          connectTimeout: 20000,
          readTimeout: 20000,
        });
        if (res.status >= 400) return null;
        const ct =
          res.headers?.["Content-Type"] ||
          res.headers?.["content-type"] ||
          "image/jpeg";
        const objectUrl = bytesToObjectUrl(res.data as ArrayBuffer | string, ct);
        objectUrlCache.set(src, objectUrl);
        return objectUrl;
      } catch {
        return null;
      } finally {
        inflight.delete(src);
      }
    })();
    inflight.set(src, pending);
  }
  return (await pending) ?? undefined;
}

export function useResolvedMediaUrl(
  url: string | undefined | null,
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    const src = String(url || "").trim();
    if (!src) return undefined;
    if (!needsNativeMediaFetch(src)) return src;
    return objectUrlCache.get(src);
  });

  useEffect(() => {
    let cancelled = false;
    const src = String(url || "").trim();
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (!needsNativeMediaFetch(src)) {
      setResolved(src);
      return;
    }
    const cached = objectUrlCache.get(src);
    if (cached) {
      setResolved(cached);
      return;
    }
    setResolved(undefined);
    void resolveMediaDisplayUrl(src).then((next) => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}

type MediaImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackClassName?: string;
};

/** `<img>` that loads cleartext *arr posters through CapacitorHttp on device. */
export function MediaImg({
  src,
  fallbackClassName = "poster-fallback",
  className,
  alt = "",
  ...rest
}: MediaImgProps) {
  const resolved = useResolvedMediaUrl(src);
  if (!resolved) {
    return <div className={fallbackClassName} aria-hidden />;
  }
  return <img src={resolved} alt={alt} className={className} {...rest} />;
}

/** Fanart / CSS background helper — same http→blob resolution as MediaImg. */
export function useMediaBackground(
  url: string | undefined | null,
  overlay = "linear-gradient(90deg, rgba(12,16,20,.92), rgba(12,16,20,.55))",
): CSSProperties | undefined {
  const resolved = useResolvedMediaUrl(url);
  if (!resolved) return undefined;
  return {
    backgroundImage: `${overlay}, url(${JSON.stringify(resolved)})`,
  };
}
