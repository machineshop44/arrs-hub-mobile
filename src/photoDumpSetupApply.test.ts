import { describe, expect, it } from "vitest";
import {
  isLanHubUrl,
  isWanHubUrl,
  planPhotoDumpSetupApply,
  preferHubRemoteUrl,
} from "./photoDumpSetupApply";

describe("photoDumpSetupApply", () => {
  it("classifies LAN vs WAN hosts", () => {
    expect(isLanHubUrl("http://192.168.1.50:3000")).toBe(true);
    expect(isWanHubUrl("http://192.168.1.50:3000")).toBe(false);
    expect(isWanHubUrl("http://67.84.101.14:3000")).toBe(true);
    expect(isLanHubUrl("http://67.84.101.14:3000")).toBe(false);
    expect(isWanHubUrl("https://hub.example.com")).toBe(true);
  });

  it("LAN QR updates homeBaseUrl and does not overwrite WAN hub", () => {
    const plan = planPhotoDumpSetupApply({
      scannedUrl: "http://192.168.1.50:3000",
      existingWolHubUrl: "http://67.84.101.14",
      existingPhotoDumpUrl: "http://67.84.101.14",
    });
    expect(plan.homeBaseUrl).toBe("http://192.168.1.50");
    expect(plan.wolHubUrl).toBeUndefined();
    expect(plan.wolHubPort).toBe(3000);
    expect(plan.photoDumpUrl).toBeUndefined();
  });

  it("LAN QR clears private photo-dump url so wol.hubUrl is used", () => {
    const plan = planPhotoDumpSetupApply({
      scannedUrl: "http://10.0.0.8:3000",
      existingWolHubUrl: "http://67.84.101.14",
      existingPhotoDumpUrl: "http://192.168.1.50",
    });
    expect(plan.homeBaseUrl).toBe("http://10.0.0.8");
    expect(plan.wolHubUrl).toBeUndefined();
    expect(plan.photoDumpUrl).toBe("");
  });

  it("LAN QR never writes LAN into empty wol.hubUrl", () => {
    const plan = planPhotoDumpSetupApply({
      scannedUrl: "http://192.168.1.50:3000",
      existingWolHubUrl: "",
      existingPhotoDumpUrl: "",
    });
    expect(plan.homeBaseUrl).toBe("http://192.168.1.50");
    expect(plan.wolHubUrl).toBeUndefined();
    expect(plan.photoDumpUrl).toBe("");
  });

  it("WAN QR sets wol.hubUrl and photo-dump url", () => {
    const plan = planPhotoDumpSetupApply({
      scannedUrl: "http://67.84.101.14:3000",
      existingWolHubUrl: "http://192.168.1.50",
      existingPhotoDumpUrl: "http://192.168.1.50",
    });
    expect(plan.homeBaseUrl).toBeUndefined();
    expect(plan.wolHubUrl).toBe("http://67.84.101.14");
    expect(plan.wolHubPort).toBe(3000);
    expect(plan.photoDumpUrl).toBe("http://67.84.101.14");
  });

  it("preferHubRemoteUrl recovers from LAN service.url when wol is WAN", () => {
    expect(
      preferHubRemoteUrl("http://192.168.1.50", "http://67.84.101.14"),
    ).toBe("http://67.84.101.14");
    expect(preferHubRemoteUrl("", "http://67.84.101.14")).toBe(
      "http://67.84.101.14",
    );
    expect(
      preferHubRemoteUrl("http://67.84.101.14", "http://192.168.1.50"),
    ).toBe("http://67.84.101.14");
  });
});
