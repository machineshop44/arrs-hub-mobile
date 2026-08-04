import { Capacitor, registerPlugin } from "@capacitor/core";

type ExternalPlayerPlugin = {
  openInVlc(options: {
    url: string;
  }): Promise<{ opened: boolean; vlcInstalled: boolean; message?: string }>;
  openExternally(options: { url: string }): Promise<{ opened: boolean }>;
  openVlcStore(): Promise<void>;
};

const ExternalPlayer = registerPlugin<ExternalPlayerPlugin>("ExternalPlayer");

function assertNative(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("External players are only available in the Android app.");
  }
}

/** Open stream URL in VLC (org.videolan.vlc). Returns whether it launched. */
export async function openStreamInVlc(url: string): Promise<{
  opened: boolean;
  vlcInstalled: boolean;
  message?: string;
}> {
  assertNative();
  const trimmed = url.trim();
  if (!trimmed) throw new Error("No stream URL to open.");
  return ExternalPlayer.openInVlc({ url: trimmed });
}

/** System chooser for any installed video player. */
export async function openStreamExternally(url: string): Promise<void> {
  assertNative();
  const trimmed = url.trim();
  if (!trimmed) throw new Error("No stream URL to open.");
  await ExternalPlayer.openExternally({ url: trimmed });
}

/** Play Store / browser listing for VLC. */
export async function openVlcInstallPage(): Promise<void> {
  assertNative();
  await ExternalPlayer.openVlcStore();
}
