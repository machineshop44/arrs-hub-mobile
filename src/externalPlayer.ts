import { Capacitor, registerPlugin } from "@capacitor/core";

type VlcPlaylistItem = {
  url: string;
  title?: string;
};

type ExternalPlayerPlugin = {
  openInVlc(options: {
    url: string;
  }): Promise<{ opened: boolean; vlcInstalled: boolean; message?: string }>;
  openPlaylistInVlc(options: {
    items: VlcPlaylistItem[];
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

/**
 * Open warm-up + day (or any list) in the VLC app.
 * Single URL uses ACTION_VIEW; multiple URLs use a temp M3U via FileProvider.
 */
export async function openPlaylistInVlc(
  items: VlcPlaylistItem[],
): Promise<{
  opened: boolean;
  vlcInstalled: boolean;
  message?: string;
}> {
  assertNative();
  const playlist = items
    .map((item) => ({
      url: (item.url || "").trim(),
      title: (item.title || "").trim(),
    }))
    .filter((item) => item.url);
  if (!playlist.length) throw new Error("No stream URL to open.");
  if (playlist.length === 1) {
    return ExternalPlayer.openInVlc({ url: playlist[0].url });
  }
  return ExternalPlayer.openPlaylistInVlc({ items: playlist });
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
