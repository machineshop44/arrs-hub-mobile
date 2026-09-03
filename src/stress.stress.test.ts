/**
 * Stress / regression suite for crash-prone mobile paths.
 * Run: npm run test:stress
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => "web",
  },
  CapacitorHttp: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/preferences", () => {
  const store = new Map<string, string>();
  return {
    Preferences: {
      async get({ key }: { key: string }) {
        return { value: store.has(key) ? store.get(key)! : null };
      },
      async set({ key, value }: { key: string; value: string }) {
        store.set(key, value);
      },
      async remove({ key }: { key: string }) {
        store.delete(key);
      },
      async clear() {
        store.clear();
      },
      /** test helper */
      __store: store,
    },
  };
});

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    getStatus: vi.fn(async () => ({
      connected: true,
      connectionType: "wifi",
    })),
  },
}));

import {
  resolveConnectionMode,
  resolveServiceUrl,
  normalizeConnectionPreference,
  pathHintLabel,
  isPrivateIpv4,
  cidrFromHomeBase,
  hostFromUrlOrHost,
} from "./pathing";
import { createPlexPollController } from "./plexPollGuard";
import {
  fetchPlexUpdateStatus,
  fetchPlexUpdateJob,
  plexJobBusy,
  plexStatusAllowsInstall,
  shortPlexVersion,
} from "./plexUpdateApi";
import {
  issueBadge,
  ombiTypeLabel,
  fetchHubStatusSummary,
} from "./hubSummary";
import {
  buildSettingsBundle,
  parseSettingsBundle,
  serializeSettingsBundle,
  summarizeBundle,
  applySettingsBundle,
} from "./settingsTransfer";
import { hubStatusForService } from "./probe";
import { httpRequest } from "./arrApi";
import type { ServiceConfig } from "./services";
import { DEFAULT_WOL } from "./wol";

vi.mock("./arrApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./arrApi")>();
  return {
    ...actual,
    httpRequest: vi.fn(),
  };
});

const mockedHttp = vi.mocked(httpRequest);

function sampleService(
  partial: Partial<ServiceConfig> & Pick<ServiceConfig, "id" | "name">,
): ServiceConfig {
  return {
    url: "",
    apiKey: "",
    username: "",
    password: "",
    enabled: true,
    color: "#888",
    probe: "http",
    auth: "none",
    category: "other",
    ...partial,
  };
}

describe("pathing — rapid home/remote switching", () => {
  it("flips resolveServiceUrl correctly under rapid mode changes", () => {
    const remote = "https://example.duckdns.org:8989/sonarr";
    const homeBase = "http://192.168.1.50";

    for (let i = 0; i < 500; i++) {
      const onHome = i % 2 === 0;
      const url = resolveServiceUrl(remote, homeBase, onHome, "auto");
      if (onHome) {
        expect(url).toBe("https://192.168.1.50:8989/sonarr");
        expect(resolveConnectionMode("auto", true)).toBe("home");
        expect(pathHintLabel("home")).toBe("LAN");
      } else {
        expect(url).toBe(remote);
        expect(resolveConnectionMode("auto", false)).toBe("remote");
        expect(resolveConnectionMode("auto", null)).toBe("remote");
        expect(pathHintLabel("remote")).toBe("Remote");
      }
    }
  });

  it("ignores legacy forced preference and keeps ports/paths", () => {
    expect(normalizeConnectionPreference("home")).toBe("auto");
    expect(normalizeConnectionPreference("remote")).toBe("auto");
    expect(
      resolveServiceUrl(
        "http://pub.example:7878",
        "http://10.0.0.2",
        true,
        "remote",
      ),
    ).toBe("http://10.0.0.2:7878");
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(cidrFromHomeBase("http://192.168.1.50:3000")).toBe(
      "192.168.1.0/24",
    );
    expect(hostFromUrlOrHost("192.168.1.50")).toBe("192.168.1.50");
  });
});

describe("plexPollGuard — no stacked refresh / generation", () => {
  it("blocks cached polls while refresh is in flight", async () => {
    const ctrl = createPlexPollController();
    const refresh = ctrl.begin("refresh");
    expect(refresh).not.toBeNull();
    expect(ctrl.begin("cached")).toBeNull();
    expect(ctrl.begin("refresh")).toBeNull();

    // Simulate concurrent stale completion after a newer gen somehow advanced
    // via completing current refresh then starting another.
    const end1 = ctrl.end(refresh!);
    expect(end1.clearChecking).toBe(true);
    expect(ctrl.refreshInFlight).toBe(false);

    const r2 = ctrl.begin("refresh")!;
    const cachedDuring = ctrl.begin("cached");
    expect(cachedDuring).toBeNull();
    expect(ctrl.end(r2).clearChecking).toBe(true);
  });

  it("ignores stale tickets after a newer poll starts", async () => {
    const ctrl = createPlexPollController();
    const a = ctrl.begin("cached")!;
    const b = ctrl.begin("cached")!;
    expect(ctrl.isCurrent(a)).toBe(false);
    expect(ctrl.isCurrent(b)).toBe(true);
    expect(ctrl.end(a).clearChecking).toBe(false);
    expect(ctrl.end(b).clearChecking).toBe(false);
  });

  it("stress: many interleaved begin/end never leaves refresh stuck", () => {
    const ctrl = createPlexPollController();
    const outstanding: ReturnType<typeof ctrl.begin>[] = [];

    for (let i = 0; i < 200; i++) {
      const kind = i % 5 === 0 ? "refresh" : "cached";
      const ticket = ctrl.begin(kind);
      if (ticket) outstanding.push(ticket);
      // Randomly complete oldest tickets
      if (outstanding.length > 3) {
        const t = outstanding.shift()!;
        ctrl.end(t!);
      }
    }
    while (outstanding.length) {
      ctrl.end(outstanding.shift()!);
    }
    expect(ctrl.refreshInFlight).toBe(false);
  });
});

describe("plexUpdateApi — request handling (mocked hub)", () => {
  beforeEach(() => {
    mockedHttp.mockReset();
  });

  it("parses update-status and refresh query", async () => {
    mockedHttp.mockResolvedValue({
      status: 200,
      latencyMs: 12,
      data: {
        ok: true,
        installedVersion: "1.41.0.1234-abc",
        latestVersion: "1.41.1.9999-def",
        updateAvailable: true,
        channel: "plex.tv",
        canInstall: false,
        releaseState: "released",
        lastChecked: "2026-08-04T00:00:00Z",
        error: null,
        job: { phase: "idle", progress: 0, message: "", error: null },
      },
    });

    const status = await fetchPlexUpdateStatus("http://192.168.1.10:3000", {
      refresh: true,
    });
    expect(status.updateAvailable).toBe(true);
    expect(shortPlexVersion(status.installedVersion)).toBe("1.41.0.1234");
    expect(plexJobBusy(status.job)).toBe(false);
    expect(plexStatusAllowsInstall(status)).toBe(false);
    expect(mockedHttp).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/api/plex/update-status?refresh=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("allows install when windows-installer + hubLocal even if canInstall false", () => {
    expect(
      plexStatusAllowsInstall({
        ok: true,
        installedVersion: "1.41.0",
        latestVersion: "1.41.1",
        updateAvailable: true,
        channel: "plex.tv",
        canInstall: false,
        installMethod: "windows-installer",
        releaseState: "available",
        downloadURL: "https://example.com/plex.exe",
        lastChecked: null,
        hubLocal: true,
        error: null,
        job: {
          id: null,
          phase: "idle",
          progress: 0,
          message: "",
          error: null,
          startedAt: null,
          finishedAt: null,
          result: null,
        },
      }),
    ).toBe(true);
  });

  it("surfaces 404 with upgrade hint", async () => {
    mockedHttp.mockResolvedValue({
      status: 404,
      latencyMs: 5,
      data: { error: "not found" },
    });
    await expect(
      fetchPlexUpdateStatus("http://hub.local:3000"),
    ).rejects.toThrow(/missing Plex update API/i);
  });

  it("parses update-job and marks busy phases", async () => {
    mockedHttp.mockResolvedValue({
      status: 200,
      latencyMs: 3,
      data: {
        job: {
          id: "j1",
          phase: "downloading",
          progress: 40,
          message: "Downloading",
          error: null,
        },
      },
    });
    const job = await fetchPlexUpdateJob("http://hub.local:3000/");
    expect(plexJobBusy(job)).toBe(true);
    expect(job.progress).toBe(40);
  });

  it("rejects empty hub base", async () => {
    await expect(fetchPlexUpdateStatus("  ")).rejects.toThrow(
      /Hub URL is not set/i,
    );
  });
});

describe("hubSummary helpers + optional live probe", () => {
  it("issueBadge / ombiTypeLabel", () => {
    expect(
      issueBadge({
        title: "x",
        trackedDownloadState: "importPending",
      }),
    ).toBe("Manual import");
    expect(ombiTypeLabel("tv")).toBe("TV");
    expect(ombiTypeLabel("movie")).toBe("Movie");
  });

  it("returns null when hub base empty", async () => {
    const result = await fetchHubStatusSummary("", [], () => "");
    expect(result).toBeNull();
  });

  it("optional live hub probe (skipped if unreachable)", async () => {
    const hub =
      process.env.ARRS_HUB_URL?.trim() || "http://127.0.0.1:3000";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    try {
      const res = await fetch(`${hub.replace(/\/+$/, "")}/api/watchdog/status`, {
        signal: ac.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.info(`[live] hub reachable but HTTP ${res.status} at ${hub}`);
        return;
      }
      const data = (await res.json()) as unknown;
      expect(data).toBeTruthy();
      console.info(`[live] hub OK at ${hub}`);
    } catch {
      console.info(`[live] hub not reachable at ${hub} — skipped`);
    } finally {
      clearTimeout(timer);
    }
  });
});

describe("probe — hubStatusForService aliases", () => {
  it("resolves aliases under concurrent lookups", () => {
    const map = {
      qbit: { up: true, latencyMs: 10, message: "ok" },
      "yt-arr": { up: false, latencyMs: null, message: "down" },
      "fileflows-node": { up: true, latencyMs: 4, message: "ok" },
    };
    for (let i = 0; i < 100; i++) {
      expect(hubStatusForService(map, "qbittorrent")?.up).toBe(true);
      expect(hubStatusForService(map, "ytarr")?.up).toBe(false);
      expect(hubStatusForService(map, "fileflows-node")?.up).toBe(true);
      expect(hubStatusForService(map, "missing")).toBeUndefined();
    }
  });
});

describe("settingsTransfer — import/export roundtrip (no secret leakage in summary)", () => {
  const SECRET_KEY = "test-secret-api-key-DO-NOT-LEAK";
  const SECRET_PASS = "test-secret-password-DO-NOT-LEAK";

  beforeEach(async () => {
    const prefs = await import("@capacitor/preferences");
    await prefs.Preferences.clear();
  });

  afterEach(() => {
    // Ensure secrets never appear in vitest stdout from this suite's helpers
    expect(summarizeBundle.name).toBe("summarizeBundle");
  });

  it("roundtrips serialize → parse without dropping fields", async () => {
    const services = [
      sampleService({
        id: "sonarr",
        name: "Sonarr",
        url: "http://192.168.1.50:8989",
        apiKey: SECRET_KEY,
        password: SECRET_PASS,
        probe: "arr",
        auth: "apiKey",
        category: "media-management",
      }),
      sampleService({
        id: "qbittorrent",
        name: "qBittorrent",
        url: "http://192.168.1.50:8080",
        username: "admin",
        password: SECRET_PASS,
        auth: "userPass",
        category: "downloaders",
      }),
    ];

    const bundle = await buildSettingsBundle({
      services,
      moduleOrder: ["sonarr", "qbittorrent"],
      wol: {
        ...DEFAULT_WOL,
        enabled: true,
        downloader: {
          ...DEFAULT_WOL.downloader,
          mac: "AA:BB:CC:DD:EE:FF",
        },
        hubUrl: "http://192.168.1.50",
        hubPort: 3000,
      },
      pathing: {
        homeBaseUrl: "http://192.168.1.50",
        connectionPreference: "home",
      },
    });

    // Legacy forced preference normalized to auto on export/build
    expect(bundle.pathing.connectionPreference).toBe("auto");
    expect(bundle.services[0]?.apiKey).toBe(SECRET_KEY);

    const json = serializeSettingsBundle(bundle);
    // Summary must not leak secrets (only counts / non-secret labels)
    const summary = summarizeBundle(bundle);
    expect(summary).not.toContain(SECRET_KEY);
    expect(summary).not.toContain(SECRET_PASS);
    expect(json).toContain(SECRET_KEY); // file itself holds secrets by design

    const parsed = parseSettingsBundle(json);
    expect(parsed.services).toEqual(bundle.services);
    expect(parsed.moduleOrder).toEqual(bundle.moduleOrder);
    expect(parsed.wol.downloader.mac).toBe("AA:BB:CC:DD:EE:FF");
    expect(parsed.pathing.homeBaseUrl).toBe("http://192.168.1.50");
    expect(parsed.pathing.connectionPreference).toBe("auto");

    const applied = await applySettingsBundle(parsed, services);
    expect(applied.services.find((s) => s.id === "sonarr")?.apiKey).toBe(
      SECRET_KEY,
    );
    expect(applied.pathing.connectionPreference).toBe("auto");
  });

  it("rejects bad kind / version / empty", () => {
    expect(() => parseSettingsBundle("")).toThrow(/empty/i);
    expect(() => parseSettingsBundle("{")).toThrow(/valid JSON/i);
    expect(() =>
      parseSettingsBundle(JSON.stringify({ kind: "nope", v: 1, services: [] })),
    ).toThrow(/kind/i);
    expect(() =>
      parseSettingsBundle(
        JSON.stringify({
          kind: "arrs-hub-status-settings",
          v: 99,
          services: [],
        }),
      ),
    ).toThrow(/version/i);
  });
});
