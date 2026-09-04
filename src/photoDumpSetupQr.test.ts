import { describe, expect, it } from "vitest";
import {
  encodePhotoDumpSetupPayload,
  parsePhotoDumpSetupPayload,
  PHOTO_DUMP_SETUP_SCHEME,
} from "./photoDumpSetupQr";

describe("photoDumpSetupQr", () => {
  const url = "http://example.com:3000";
  const key = "secret-key-abc";

  it("parses URI payload with encoded params", () => {
    const raw = encodePhotoDumpSetupPayload({ url, key });
    expect(raw.startsWith(`${PHOTO_DUMP_SETUP_SCHEME}://v1?`)).toBe(true);
    expect(parsePhotoDumpSetupPayload(raw)).toEqual({ url, key });
  });

  it("parses compact JSON payload", () => {
    const raw = encodePhotoDumpSetupPayload({ url, key }, { asJson: true });
    expect(raw).toBe(JSON.stringify({ v: 1, url, key }));
    expect(parsePhotoDumpSetupPayload(raw)).toEqual({ url, key });
  });

  it("decodes URL-encoded query values", () => {
    const nested = "http://192.168.1.10:3000/path?x=1";
    const qs = new URLSearchParams({ url: nested, key: "k&1" });
    const raw = `${PHOTO_DUMP_SETUP_SCHEME}://v1?${qs.toString()}`;
    expect(parsePhotoDumpSetupPayload(raw)).toEqual({
      url: nested,
      key: "k&1",
    });
  });

  it("rejects empty, wrong scheme, and missing fields", () => {
    expect(() => parsePhotoDumpSetupPayload("")).toThrow(/empty/);
    expect(() =>
      parsePhotoDumpSetupPayload("https://example.com/?url=1&key=2"),
    ).toThrow(/scheme/);
    expect(() =>
      parsePhotoDumpSetupPayload(
        JSON.stringify({ v: 1, url: "http://x", key: "" }),
      ),
    ).toThrow(/missing key/);
    expect(() =>
      parsePhotoDumpSetupPayload(
        JSON.stringify({ v: 2, url: "http://x", key: "k" }),
      ),
    ).toThrow(/version/);
  });
});
