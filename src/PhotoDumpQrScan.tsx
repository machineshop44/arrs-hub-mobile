import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import {
  parsePhotoDumpSetupPayload,
  type PhotoDumpSetupPayload,
} from "./photoDumpSetupQr";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getBarcodeDetector():
  | (new (opts?: { formats?: string[] }) => BarcodeDetectorLike)
  | null {
  const w = window as Window & {
    BarcodeDetector?: new (opts?: {
      formats?: string[];
    }) => BarcodeDetectorLike;
  };
  return typeof w.BarcodeDetector === "function" ? w.BarcodeDetector : null;
}

async function decodeImageFile(file: File): Promise<string> {
  const Detector = getBarcodeDetector();
  if (Detector) {
    const bitmap = await createImageBitmap(file);
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const codes = await detector.detect(bitmap);
      const raw = codes.find((c) => c.rawValue?.trim())?.rawValue?.trim();
      if (raw) return raw;
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(url);
    const text = result.getText()?.trim();
    if (!text) throw new Error("No QR code found in image");
    return text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface PhotoDumpQrScanProps {
  onPayload: (payload: PhotoDumpSetupPayload) => void | Promise<void>;
  className?: string;
}

/**
 * Scan a Hub photo-dump setup QR via live camera (BarcodeDetector / ZXing)
 * or by picking a QR image. Capacitor Android WebView friendly.
 */
export function PhotoDumpQrScan({ onPayload, className }: PhotoDumpQrScanProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const rafRef = useRef<number | null>(null);
  const handledRef = useRef(false);

  const stopCamera = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore
    }
    controlsRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
  };

  const close = () => {
    stopCamera();
    setOpen(false);
    setBusy(false);
    handledRef.current = false;
  };

  const applyRaw = async (raw: string) => {
    if (handledRef.current) return;
    const payload = parsePhotoDumpSetupPayload(raw);
    handledRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onPayload(payload);
      close();
    } catch (err) {
      handledRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    handledRef.current = false;
    setError(null);

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;

      const Detector = getBarcodeDetector();
      if (Detector && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
          if (cancelled) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          streamRef.current = stream;
          video.srcObject = stream;
          await video.play();
          const detector = new Detector({ formats: ["qr_code"] });
          const tick = async () => {
            if (cancelled || handledRef.current) return;
            try {
              if (video.readyState >= 2) {
                const codes = await detector.detect(video);
                const raw = codes.find((c) => c.rawValue?.trim())?.rawValue;
                if (raw) {
                  await applyRaw(raw);
                  return;
                }
              }
            } catch {
              // keep scanning
            }
            rafRef.current = requestAnimationFrame(() => {
              void tick();
            });
          };
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
          return;
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not open camera — pick a QR image instead.",
            );
          }
          // fall through to zxing if possible
        }
      }

      try {
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
            },
          },
          video,
          (result) => {
            if (cancelled || handledRef.current || !result) return;
            void applyRaw(result.getText()).catch(() => {
              // keep scanning until payload validates
            });
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not open camera — pick a QR image instead.",
          );
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await decodeImageFile(file);
      await applyRaw(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className={className ?? "photo-dump-qr-scan"}>
      <button
        type="button"
        className="btn chip"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        Scan setup QR
      </button>

      {open && (
        <div className="photo-dump-qr-overlay" role="dialog" aria-modal="true">
          <div className="photo-dump-qr-sheet">
            <div className="photo-dump-qr-head">
              <strong>Scan Hub setup QR</strong>
              <button
                type="button"
                className="icon-btn"
                onClick={close}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="hint" style={{ padding: "0 0 0.5rem" }}>
              Point at the QR from Hub Settings → Photo dump, or choose a
              screenshot.
            </p>
            <video
              ref={videoRef}
              className="photo-dump-qr-video"
              playsInline
              muted
              autoPlay
            />
            {error && <div className="err banner">{error}</div>}
            <div className="photo-dump-qr-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  e.target.value = "";
                  void onPickFile(file);
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Choose QR image
              </button>
              <button type="button" className="btn chip" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
