import { Capacitor, registerPlugin } from "@capacitor/core";

type VlcPlaylistItem = {
  url: string;
  title?: string;
};

type VlcPlayerPlugin = {
  isAvailable(): Promise<{ available: boolean; message?: string }>;
  play(options: {
    items: VlcPlaylistItem[];
    startIndex?: number;
  }): Promise<{ started: boolean; count: number }>;
  addListener(
    eventName: "closed",
    listenerFunc: (event: { finished: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const VlcPlayer = registerPlugin<VlcPlayerPlugin>("VlcPlayer");

/** True when native libVLC is packaged and loadable. */
export async function isEmbeddedVlcAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await VlcPlayer.isAvailable();
    return result.available === true;
  } catch {
    return false;
  }
}

/**
 * Open fullscreen in-app libVLC for hub stream URLs.
 * Resolves when the native player is closed (back / ✕ / playlist end).
 */
export async function playEmbeddedVlc(
  items: VlcPlaylistItem[],
  startIndex = 0,
): Promise<{ finished: boolean }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Embedded VLC is only available in the Android app.");
  }
  const playlist = items
    .map((item) => ({
      url: (item.url || "").trim(),
      title: (item.title || "").trim(),
    }))
    .filter((item) => item.url);
  if (!playlist.length) {
    throw new Error("No stream URL to play.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    const finish = (finished: boolean) => {
      if (settled) return;
      settled = true;
      void handle?.remove();
      resolve({ finished });
    };

    void VlcPlayer.addListener("closed", (event) => {
      finish(Boolean(event?.finished));
    }).then((h) => {
      handle = h;
    });

    void VlcPlayer.play({ items: playlist, startIndex })
      .then(() => {
        /* wait for closed */
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        void handle?.remove();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
