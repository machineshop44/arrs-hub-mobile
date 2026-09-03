import { describe, expect, it } from "vitest";
import {
  buildCompanionPcStatus,
  companionChipMeta,
  mergeCompanionDisplayApps,
  pickCompanionPc,
} from "./companionStatus";
import { isCompanionOnlyService, isCompanionOnlyUrl } from "./services";
import { resolveServiceUrl } from "./pathing";
import type { ServiceConfig } from "./services";

function svc(
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

describe("companionStatus", () => {
  const pcs = [
    {
      id: "dl1",
      name: "Downloader",
      host: "192.168.1.20",
      companionUrl: "http://192.168.1.20:3901",
    },
  ];

  it("returns null without a companion PC", () => {
    expect(
      buildCompanionPcStatus([], {}, {}, {}, [], () => ""),
    ).toBeNull();
    expect(pickCompanionPc([{ id: "x", name: "PC", host: "" }])).toBeNull();
  });

  it("falls back to qBit / SAB / FileFlows Node when nothing is wired", () => {
    const services = [
      svc({ id: "qbittorrent", name: "qBittorrent" }),
      svc({ id: "sabnzbd", name: "SABnzbd" }),
      svc({ id: "fileflows-node", name: "FileFlows Node", url: "companion://local" }),
      svc({ id: "sonarr", name: "Sonarr" }),
    ];
    const summary = buildCompanionPcStatus(
      pcs,
      { dl1: { online: true, message: "Companion online" } },
      {
        qbittorrent: { up: true },
        sabnzbd: { up: false },
        "fileflows-node": { up: true },
      },
      {},
      services,
      (s) => s.url,
    );
    expect(summary?.online).toBe(true);
    expect(summary?.apps.map((a) => a.id)).toEqual([
      "qbittorrent",
      "sabnzbd",
      "fileflows-node",
    ]);
    expect(summary?.apps.find((a) => a.id === "fileflows-node")?.openUrl).toBeNull();
    expect(companionChipMeta(summary, false)?.value).toBe("2/3");
    expect(companionChipMeta(summary, false)?.tone).toBe("bad");
  });

  it("uses Port Watch restartPcId wiring when present", () => {
    const services = [
      svc({ id: "qbittorrent", name: "qBittorrent", url: "http://192.168.1.20:8080" }),
      svc({ id: "fileflows", name: "FileFlows", url: "http://192.168.1.20:19200" }),
      svc({ id: "sonarr", name: "Sonarr" }),
    ];
    const summary = buildCompanionPcStatus(
      pcs,
      { dl1: { online: true } },
      { qbittorrent: { up: true }, fileflows: { up: true } },
      {
        qbittorrent: { restartPcId: "dl1", monitor: true },
        fileflows: { restartPcId: "dl1", monitor: true },
        sonarr: { restartPcId: "other", monitor: true },
      },
      services,
      (s) => s.url,
    );
    expect(summary?.apps.map((a) => a.id)).toEqual(["qbittorrent", "fileflows"]);
    expect(companionChipMeta(summary, false)).toEqual({
      value: "2/2",
      tone: "good",
    });
  });

  it("reports Offline / Online / — chip values", () => {
    const base = buildCompanionPcStatus(
      pcs,
      { dl1: { online: false } },
      {},
      {},
      [svc({ id: "qbittorrent", name: "qBittorrent" })],
      () => "",
    );
    expect(companionChipMeta(base, false)?.value).toBe("Offline");
    expect(
      companionChipMeta(
        { ...base!, online: true, apps: [] },
        false,
      )?.value,
    ).toBe("Online");
    expect(
      companionChipMeta({ ...base!, online: null, apps: [] }, false)?.value,
    ).toBe("—");
  });

  it("merges chip-version extras in hub display order", () => {
    const merged = mergeCompanionDisplayApps(
      [{ id: "sabnzbd", label: "SABnzbd", up: true, openUrl: null }],
      [
        { id: "surfshark", label: "Surfshark" },
        { id: "qbittorrent", label: "qBittorrent" },
        { id: "fileflows-node", label: "FileFlows Node" },
      ],
    );
    expect(merged.map((a) => a.id)).toEqual([
      "qbittorrent",
      "sabnzbd",
      "fileflows-node",
      "surfshark",
    ]);
  });
});

describe("companion-only URLs", () => {
  it("does not rewrite companion:// on LAN pathing", () => {
    expect(
      resolveServiceUrl(
        "companion://local",
        "http://192.168.1.50",
        true,
        "auto",
      ),
    ).toBe("companion://local");
    expect(isCompanionOnlyUrl("companion://local")).toBe(true);
    expect(
      isCompanionOnlyService({
        id: "fileflows-node",
        url: "http://example:19200",
      }),
    ).toBe(true);
  });
});
