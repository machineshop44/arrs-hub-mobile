import { Capacitor, registerPlugin } from "@capacitor/core";

/** Values shown on the Android home-screen widget. `null` clears a stat (shows "—"); omitted keys keep the last value. */
export type HubWidgetValues = {
  streams?: number | null;
  downloads?: number | null;
  ombiPending?: number | null;
  /** Epoch ms for the "Updated HH:mm" line (defaults to now). */
  updatedAt?: number;
};

/** Wake-on-LAN target for the widget's "Wake PC" button. Empty/invalid `mac` clears it (button opens the app). */
export type HubWidgetWolTarget = {
  mac: string;
  /** Defaults to 255.255.255.255 (the widget always also sends to 255.255.255.255). */
  broadcast?: string;
  /** UDP port, default 9. */
  port?: number;
};

type HubWidgetPlugin = {
  update(options: HubWidgetValues): Promise<{ ok: boolean }>;
  setWol(options: HubWidgetWolTarget): Promise<{ ok: boolean; configured: boolean }>;
};

const HubWidget = registerPlugin<HubWidgetPlugin>("HubWidget");

function available(): boolean {
  return (
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("HubWidget")
  );
}

/** Push dashboard counts to the home-screen widget. No-op on web; never throws. */
export async function updateHubWidget(values: HubWidgetValues): Promise<void> {
  if (!available()) return;
  try {
    await HubWidget.update(values);
  } catch (err) {
    console.warn(
      "[hubWidget] update failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Store the widget's Wake PC target. No-op on web; never throws. */
export async function setHubWidgetWol(target: HubWidgetWolTarget): Promise<void> {
  if (!available()) return;
  try {
    await HubWidget.setWol({
      mac: String(target.mac || ""),
      ...(target.broadcast ? { broadcast: target.broadcast } : {}),
      ...(target.port ? { port: target.port } : {}),
    });
  } catch (err) {
    console.warn(
      "[hubWidget] setWol failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
