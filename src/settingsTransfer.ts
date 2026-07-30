import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  loadModuleOrder,
  loadServices,
  MODULE_ORDER_STORAGE_KEY,
  saveModuleOrder,
  saveServices,
  SERVICES_STORAGE_KEY,
} from "./probe";
import {
  DEFAULT_PATHING,
  loadPathSettings,
  PATHING_STORAGE_KEY,
  savePathSettings,
  type PathSettings,
} from "./pathing";
import type { ServiceConfig } from "./services";
import {
  DEFAULT_WOL,
  loadWolSettings,
  saveWolSettings,
  WOL_STORAGE_KEY,
  type WolSettings,
} from "./wol";

const CONFIG_KIND = "arrs-hub-status-settings";
const CONFIG_VERSION = 1;

/** Every Capacitor Preferences key this app persists (full backup set). */
export const PERSISTED_STORAGE_KEYS = {
  services: SERVICES_STORAGE_KEY,
  moduleOrder: MODULE_ORDER_STORAGE_KEY,
  wol: WOL_STORAGE_KEY,
  pathing: PATHING_STORAGE_KEY,
} as const;

export type SettingsBundle = {
  kind: typeof CONFIG_KIND;
  v: typeof CONFIG_VERSION;
  exportedAt: string;
  /** Maps logical sections → Preferences keys (documentation + future importers). */
  storageKeys: typeof PERSISTED_STORAGE_KEYS;
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

function normalizeWol(raw: Partial<WolSettings> | undefined): WolSettings {
  const wolRaw = raw ?? {};
  return {
    enabled: Boolean(wolRaw.enabled),
    mac: String(wolRaw.mac ?? ""),
    targetHost: String(wolRaw.targetHost ?? ""),
    broadcastIp: String(wolRaw.broadcastIp || DEFAULT_WOL.broadcastIp),
    port: Number(wolRaw.port) || DEFAULT_WOL.port,
    homeCidr: String(wolRaw.homeCidr ?? ""),
    hubUrl: String(wolRaw.hubUrl ?? ""),
    hubPcId: String(wolRaw.hubPcId ?? ""),
  };
}

function normalizePathing(raw: Partial<PathSettings> | undefined): PathSettings {
  const pathRaw = raw ?? {};
  return {
    homeBaseUrl: String(pathRaw.homeBaseUrl ?? DEFAULT_PATHING.homeBaseUrl),
  };
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
    storageKeys: { ...PERSISTED_STORAGE_KEYS },
    services: pickServiceFields(services),
    moduleOrder: [...moduleOrder],
    wol: normalizeWol(wol),
    pathing: normalizePathing(pathing),
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
    storageKeys: { ...PERSISTED_STORAGE_KEYS },
    services,
    moduleOrder,
    wol: normalizeWol(wolRaw),
    pathing: normalizePathing(pathRaw),
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
    // Restore exported snapshot fields exactly (including empty strings).
    return {
      ...def,
      url: saved.url,
      apiKey: saved.apiKey,
      username: saved.username,
      password: saved.password,
      enabled: saved.enabled,
    };
  });

  const wol = normalizeWol(bundle.wol);
  const pathing = normalizePathing(bundle.pathing);

  await Promise.all([
    saveServices(merged),
    saveModuleOrder(bundle.moduleOrder),
    saveWolSettings(wol),
    savePathSettings(pathing),
  ]);

  return {
    services: merged,
    moduleOrder: bundle.moduleOrder,
    wol,
    pathing,
  };
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

export function summarizeBundle(bundle: SettingsBundle): string {
  const withKeys = bundle.services.filter(
    (s) => s.apiKey.trim() || s.password.trim() || s.url.trim(),
  ).length;
  const wol = bundle.wol.mac.trim()
    ? `WOL ${bundle.wol.mac}`
    : bundle.wol.enabled
      ? "WOL on (no MAC)"
      : "WOL off/empty";
  const home = bundle.pathing.homeBaseUrl.trim() || "no LAN base";
  return `${withKeys} services · ${wol} · ${home}`;
}
