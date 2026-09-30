import type { PathSettings } from "./pathing";
import type { CredentialSeed } from "./services";
import type { WolSettings } from "./wol";

export type DevSeedModule = {
  default?: CredentialSeed;
  pathingDefaults?: Partial<PathSettings>;
  wolDefaults?: Partial<WolSettings>;
};

let cached: Promise<DevSeedModule> | null = null;

/**
 * Loads credentials.local.ts for `npm run dev` only. Production builds (APK)
 * must never embed it: the file holds live API keys, passwords, and the WAN IP.
 * Fresh installs are configured via Settings → Import settings file or QR.
 */
export function loadDevSeed(): Promise<DevSeedModule> {
  if (!import.meta.env.DEV) return Promise.resolve({});
  if (!cached) {
    const loaders = import.meta.glob<DevSeedModule>("./credentials.local.ts");
    const load = loaders["./credentials.local.ts"];
    cached = load ? load().catch(() => ({})) : Promise.resolve({});
  }
  return cached;
}
