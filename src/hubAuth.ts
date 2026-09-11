/**
 * Forward-compatible Hub control-plane auth (Hub hub-auth.mjs WIP).
 * Separate from photo-dump `X-Arrs-Hub-Key` — never reuse that key here.
 *
 * When token is empty, callers behave as today (current Hub has no control auth).
 * When set, send `X-Arrs-Hub-Token` on control APIs only.
 * Leave open (no token required): GET /api/health, /api/version, photo-dump minimal probe.
 */
import { Preferences } from "@capacitor/preferences";

export const HUB_API_TOKEN_STORAGE = "arrs-mobile-hub-api-token-v1";

export const HUB_AUTH_HINT =
  "Set Hub API token in Settings → Network (from Hub Settings)";

/** In-memory cache so sync header helpers work without awaiting Preferences. */
let cachedToken = "";

export function getHubApiTokenCache(): string {
  return cachedToken;
}

export function setHubApiTokenCache(token: string): void {
  cachedToken = String(token || "").trim();
}

export async function loadHubApiToken(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: HUB_API_TOKEN_STORAGE });
    const token = value?.trim() || "";
    setHubApiTokenCache(token);
    return token;
  } catch (err) {
    console.warn(
      "[hubAuth] Failed to read Hub API token:",
      err instanceof Error ? err.message : err,
    );
    return cachedToken;
  }
}

export async function saveHubApiToken(token: string): Promise<void> {
  const next = String(token || "").trim();
  setHubApiTokenCache(next);
  await Preferences.set({ key: HUB_API_TOKEN_STORAGE, value: next });
}

/** Headers for Hub control APIs. Empty when no token configured. */
export function hubAuthHeaders(): Record<string, string> {
  if (!cachedToken) return {};
  return { "X-Arrs-Hub-Token": cachedToken };
}

export function mergeHubAuthHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return { ...headers, ...hubAuthHeaders() };
}

export function isHubAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

export function hubAuthErrorMessage(status?: number): string {
  if (status === 401 || status === 403) return HUB_AUTH_HINT;
  return HUB_AUTH_HINT;
}

export class HubAuthError extends Error {
  readonly status: number;
  constructor(status = 401) {
    super(hubAuthErrorMessage(status));
    this.name = "HubAuthError";
    this.status = status;
  }
}

export function throwIfHubAuthRequired(status: number): void {
  if (isHubAuthFailure(status)) throw new HubAuthError(status);
}
