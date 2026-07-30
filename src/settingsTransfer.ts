import QRCode from "qrcode";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  loadModuleOrder,
  loadServices,
  saveModuleOrder,
  saveServices,
} from "./probe";
import {
  loadPathSettings,
  savePathSettings,
  type PathSettings,
} from "./pathing";
import type { ServiceConfig } from "./services";
import {
  loadWolSettings,
  saveWolSettings,
  type WolSettings,
} from "./wol";

const CONFIG_KIND = "arrs-hub-status-settings";
const CONFIG_VERSION = 1;
/** Soft limit for a single scannable QR (bytes of payload string). */
export const QR_MAX_CHARS = 1800;

export type SettingsBundle = {
  kind: typeof CONFIG_KIND;
  v: typeof CONFIG_VERSION;
  exportedAt: string;
  services: Array<{
    id: string;
    url: string;
    apiKey: string;
    username: string;
    password: string;
    enabled: boolean;
  }>;
  moduleOrder: string[];
  wol: WolSettings;
  pathing: PathSettings;
};

type ConfigSharePlugin = {
  shareJsonFile(options: {
    fileName: string;
    content: string;
  }): Promise<{ bytes: number; fileName: string }>;
};

const ConfigShare = registerPlugin<ConfigSharePlugin>("ApkShare");

function pickServiceFields(services: ServiceConfig[]): SettingsBundle["services"] {
  return services.map((s) => ({
    id: s.id,
    url: s.url,
    apiKey: s.apiKey,
    username: s.username,
    password: s.password,
    enabled: s.enabled,
  }));
}

export async function buildSettingsBundle(
  overrides?: Partial<{
    services: ServiceConfig[];
    moduleOrder: string[];
    wol: WolSettings;
    pathing: PathSettings;
  }>,
): Promise<SettingsBundle> {
  const [services, moduleOrder, wol, pathing] = await Promise.all([
    overrides?.services
      ? Promise.resolve(overrides.services)
      : loadServices(),
    overrides?.moduleOrder
      ? Promise.resolve(overrides.moduleOrder)
      : loadModuleOrder(),
    overrides?.wol ? Promise.resolve(overrides.wol) : loadWolSettings(),
    overrides?.pathing
      ? Promise.resolve(overrides.pathing)
      : loadPathSettings(),
  ]);

  return {
    kind: CONFIG_KIND,
    v: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    services: pickServiceFields(services),
    moduleOrder,
    wol,
    pathing,
  };
}

export function serializeSettingsBundle(bundle: SettingsBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseSettingsBundle(raw: string): SettingsBundle {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Config is empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Config is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config root must be an object.");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== CONFIG_KIND) {
    throw new Error('Not an Arrs Hub Status settings file (missing kind).');
  }
  if (obj.v !== CONFIG_VERSION) {
    throw new Error(`Unsupported settings version: ${String(obj.v)}`);
  }
  if (!Array.isArray(obj.services)) {
    throw new Error("Config services must be an array.");
  }

  const services = obj.services.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid service entry.");
    }
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id.trim()) {
      throw new Error("Service entry missing id.");
    }
    return {
      id: s.id.trim(),
      url: typeof s.url === "string" ? s.url : "",
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      username: typeof s.username === "string" ? s.username : "",
      password: typeof s.password === "string" ? s.password : "",
      enabled: typeof s.enabled === "boolean" ? s.enabled : true,
    };
  });

  const moduleOrder = Array.isArray(obj.moduleOrder)
    ? obj.moduleOrder.filter((id): id is string => typeof id === "string")
    : [];

  const wolRaw =
    obj.wol && typeof obj.wol === "object"
      ? (obj.wol as Partial<WolSettings>)
      : {};
  const pathRaw =
    obj.pathing && typeof obj.pathing === "object"
      ? (obj.pathing as Partial<PathSettings>)
      : {};

  return {
    kind: CONFIG_KIND,
    v: CONFIG_VERSION,
    exportedAt:
      typeof obj.exportedAt === "string"
        ? obj.exportedAt
        : new Date().toISOString(),
    services,
    moduleOrder,
    wol: {
      enabled: Boolean(wolRaw.enabled),
      mac: String(wolRaw.mac ?? ""),
      targetHost: String(wolRaw.targetHost ?? ""),
      broadcastIp: String(wolRaw.broadcastIp || "255.255.255.255"),
      port: Number(wolRaw.port) || 9,
      homeCidr: String(wolRaw.homeCidr ?? ""),
      hubUrl: String(wolRaw.hubUrl ?? ""),
      hubPcId: String(wolRaw.hubPcId ?? ""),
    },
    pathing: {
      homeBaseUrl: String(pathRaw.homeBaseUrl ?? ""),
    },
  };
}

export async function applySettingsBundle(
  bundle: SettingsBundle,
  currentServices: ServiceConfig[],
): Promise<{
  services: ServiceConfig[];
  moduleOrder: string[];
  wol: WolSettings;
  pathing: PathSettings;
}> {
  const byId = new Map(bundle.services.map((s) => [s.id, s]));
  const merged = currentServices.map((def) => {
    const saved = byId.get(def.id);
    if (!saved) return def;
    return {
      ...def,
      url: saved.url || def.url,
      apiKey: saved.apiKey || def.apiKey,
      username: saved.username || def.username,
      password: saved.password || def.password,
      enabled: saved.enabled,
    };
  });

  await Promise.all([
    saveServices(merged),
    saveModuleOrder(bundle.moduleOrder),
    saveWolSettings(bundle.wol),
    savePathSettings(bundle.pathing),
  ]);

  return {
    services: merged,
    moduleOrder: bundle.moduleOrder,
    wol: bundle.wol,
    pathing: bundle.pathing,
  };
}

export async function makeExportQrDataUrl(
  json: string,
): Promise<{ dataUrl: string | null; tooLarge: boolean; chars: number }> {
  const chars = json.length;
  if (chars > QR_MAX_CHARS) {
    return { dataUrl: null, tooLarge: true, chars };
  }
  const dataUrl = await QRCode.toDataURL(json, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: { dark: "#12141c", light: "#ffffff" },
  });
  return { dataUrl, tooLarge: false, chars };
}

export async function shareSettingsJsonFile(
  json: string,
  fileName = "ArrsHubStatus-settings.json",
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ConfigShare.shareJsonFile({ fileName, content: json });
    return;
  }

  if (navigator.share && navigator.canShare) {
    const file = new File([json], fileName, { type: "application/json" });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Arrs Hub Status settings",
      });
      return;
    }
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copySettingsToClipboard(json: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json);
    return;
  }
  throw new Error("Clipboard not available.");
}

export async function readSettingsFromClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error("Clipboard not available.");
}

export function summarizeBundle(bundle: SettingsBundle): string {
  const withKeys = bundle.services.filter(
    (s) => s.apiKey.trim() || s.password.trim() || s.url.trim(),
  ).length;
  const wol = bundle.wol.mac.trim()
    ? `WOL ${bundle.wol.mac}`
    : "WOL off/empty";
  const home = bundle.pathing.homeBaseUrl.trim() || "no LAN base";
  return `${withKeys} services · ${wol} · ${home}`;
}
