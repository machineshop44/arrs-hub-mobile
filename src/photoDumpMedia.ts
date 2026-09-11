import { Capacitor, registerPlugin } from "@capacitor/core";

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
};

const PhotoDumpMedia = registerPlugin<PhotoDumpMediaPlugin>("PhotoDumpMedia");

export function isPhotoDumpMediaNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
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

/** Decode plugin base64 into an ArrayBuffer for hashing/upload. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
