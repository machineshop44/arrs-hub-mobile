import { describe, expect, it } from "vitest";
import {
  PHOTO_DUMP_MIN_HUB_VERSION,
  isHubVersionOlderThan,
  photoDumpHubVersionWarning,
} from "./hubVersion";

describe("hubVersion", () => {
  it("compares semver correctly", () => {
    expect(isHubVersionOlderThan("1.3.65", "1.3.66")).toBe(true);
    expect(isHubVersionOlderThan("1.3.66", "1.3.66")).toBe(false);
    expect(isHubVersionOlderThan("1.3.67", "1.3.66")).toBe(false);
    expect(isHubVersionOlderThan("v1.3.65", PHOTO_DUMP_MIN_HUB_VERSION)).toBe(
      true,
    );
    expect(isHubVersionOlderThan(null, "1.3.66")).toBe(false);
    expect(isHubVersionOlderThan("", "1.3.66")).toBe(false);
  });

  it("builds photo-dump warning only when behind", () => {
    expect(photoDumpHubVersionWarning("1.3.65")).toMatch(/1\.3\.66/);
    expect(photoDumpHubVersionWarning("1.3.66")).toBeNull();
    expect(photoDumpHubVersionWarning(null)).toBeNull();
  });
});
