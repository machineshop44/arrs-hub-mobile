/**
 * Arrs Hub photo-dump setup QR payload encode/decode (Market Advisor companion style).
 *
 * URI: arrs-hub-photo-dump://v1?url=<hubBaseUrl>&key=<apiKey>&token=<hubApiToken>
 * JSON: {"v":1,"url":"...","key":"...","token":"..."}
 *
 * `token` (Hub API / X-Arrs-Hub-Token) is optional for back-compat with older Hub QRs.
 */

export const PHOTO_DUMP_SETUP_SCHEME = "arrs-hub-photo-dump";
export const PHOTO_DUMP_SETUP_VERSION = 1;

export type PhotoDumpSetupPayload = {
  url: string;
  key: string;
  /** Hub control-plane token (X-Arrs-Hub-Token). Omitted on older QRs. */
  token?: string;
};

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`missing ${label}`);
  }
  return trimmed;
}

function optionalTrimmed(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function parseVersionToken(token: string): number {
  const t = token.trim();
  if (!t.startsWith("v")) {
    throw new Error(`missing version in URI: ${JSON.stringify(t)}`);
  }
  const n = Number(t.slice(1));
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`invalid version: ${t}`);
  }
  return n;
}

function parseJsonPayload(text: string): PhotoDumpSetupPayload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("JSON payload must be an object");
  }
  const obj = data as Record<string, unknown>;
  const ver = Number(obj.v ?? 0);
  if (ver !== PHOTO_DUMP_SETUP_VERSION) {
    throw new Error(`unsupported payload version: ${ver}`);
  }
  const token = optionalTrimmed(obj.token);
  return {
    url: requireNonEmpty(String(obj.url ?? ""), "url"),
    key: requireNonEmpty(String(obj.key ?? ""), "key"),
    ...(token ? { token } : {}),
  };
}

function parseUriPayload(text: string): PhotoDumpSetupPayload {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("invalid setup URI");
  }
  if (parsed.protocol.replace(/:$/, "") !== PHOTO_DUMP_SETUP_SCHEME) {
    throw new Error(
      `unsupported scheme: ${parsed.protocol.replace(/:$/, "") || "(none)"}`,
    );
  }
  // URL puts "v1" in hostname for arrs-hub-photo-dump://v1?...
  const verToken =
    parsed.hostname ||
    parsed.pathname.replace(/^\/+/, "").split("/")[0] ||
    "";
  const ver = parseVersionToken(verToken);
  if (ver !== PHOTO_DUMP_SETUP_VERSION) {
    throw new Error(`unsupported payload version: ${ver}`);
  }
  const url = requireNonEmpty(parsed.searchParams.get("url") || "", "url");
  const key = requireNonEmpty(parsed.searchParams.get("key") || "", "key");
  const token = optionalTrimmed(parsed.searchParams.get("token"));
  return { url, key, ...(token ? { token } : {}) };
}

/**
 * Parse a photo-dump setup QR payload (URI or compact JSON).
 * Throws Error on invalid / unsupported payloads.
 */
export function parsePhotoDumpSetupPayload(raw: string): PhotoDumpSetupPayload {
  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("empty payload");
  }
  if (text.startsWith("{")) {
    return parseJsonPayload(text);
  }
  return parseUriPayload(text);
}

/** Build a versioned setup string (URI by default). */
export function encodePhotoDumpSetupPayload(
  payload: PhotoDumpSetupPayload,
  opts?: { asJson?: boolean },
): string {
  const url = requireNonEmpty(payload.url, "url");
  const key = requireNonEmpty(payload.key, "key");
  const token = optionalTrimmed(payload.token);
  if (opts?.asJson) {
    return JSON.stringify({
      v: PHOTO_DUMP_SETUP_VERSION,
      url,
      key,
      ...(token ? { token } : {}),
    });
  }
  const qs = new URLSearchParams();
  qs.set("url", url);
  qs.set("key", key);
  if (token) qs.set("token", token);
  return `${PHOTO_DUMP_SETUP_SCHEME}://v${PHOTO_DUMP_SETUP_VERSION}?${qs.toString()}`;
}
