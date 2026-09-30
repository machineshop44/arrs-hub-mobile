/**
 * Compare Hub semver strings (e.g. "1.3.66") for feature gates.
 */

export const PHOTO_DUMP_MIN_HUB_VERSION = "1.3.66";

function parseSemverParts(raw: string): number[] {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[^\d.]/)[0] || "";
  return cleaned.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** True when current is strictly older than min (unknown/empty → false). */
export function isHubVersionOlderThan(
  current: string | null | undefined,
  min: string,
): boolean {
  const cur = String(current || "").trim();
  if (!cur) return false;
  const a = parseSemverParts(cur);
  const b = parseSemverParts(min);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

export function photoDumpHubVersionWarning(
  hubVersion: string | null | undefined,
): string | null {
  if (!isHubVersionOlderThan(hubVersion, PHOTO_DUMP_MIN_HUB_VERSION)) {
    return null;
  }
  return `Hub ${String(hubVersion).trim()} is behind ${PHOTO_DUMP_MIN_HUB_VERSION} — update Arrs Hub for reliable photo sync (empty-reply + rate-limit fixes).`;
}
