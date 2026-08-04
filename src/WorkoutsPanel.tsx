import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAndroidBackHandler } from "./androidBack";
import {
  openStreamExternally,
  openStreamInVlc,
  openVlcInstallPage,
} from "./externalPlayer";
import { ServiceIcon } from "./icons";
import type { ServiceConfig } from "./services";
import {
  fetchWorkoutClients,
  fetchWorkoutDiscover,
  fetchWorkoutSettings,
  LOCAL_CLIENT_ID,
  playWorkoutDay,
  probeHubReachable,
  type PlaylistItem,
  type WorkoutClient,
  type WorkoutDay,
  type WorkoutSettings,
  type WorkoutWarmup,
} from "./workoutsApi";

interface WorkoutsPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  onOpenSettings: () => void;
  /** Same CIDR/home detection as WOL — when not true, hide LAN cast targets. */
  onHomeNetwork?: boolean | null;
}

const LOCAL_ONLY_CLIENT: WorkoutClient = {
  name: "This device (play here)",
  machineIdentifier: LOCAL_CLIENT_ID,
  address: "local",
  port: 0,
  castType: "local",
  kind: "local",
  kindLabel: "This device",
};

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function withStreamOffset(url: string, offsetSeconds: number) {
  try {
    const next = new URL(url, "http://local.invalid");
    next.searchParams.set(
      "offset",
      String(Math.max(0, Math.floor(offsetSeconds * 1000))),
    );
    next.searchParams.set("X-Plex-Session-Id", `${Date.now()}`);
    if (url.startsWith("/")) {
      return `${next.pathname}${next.search}`;
    }
    return next.toString();
  } catch {
    return url;
  }
}

function clientKindLabel(client: WorkoutClient): string {
  if (client.kindLabel) return client.kindLabel;
  if (client.kind === "tv") return "TV";
  if (client.kind === "speaker") return "Speaker";
  if (client.kind === "phone") return "Phone";
  if (client.kind === "app") return "App";
  if (client.castType === "local" || client.machineIdentifier === LOCAL_CLIENT_ID) {
    return "This device";
  }
  return "";
}

function formatClientOption(client: WorkoutClient): string {
  const kind = clientKindLabel(client);
  if (client.castType === "local" || client.machineIdentifier === LOCAL_CLIENT_ID) {
    return client.name;
  }
  const prefix =
    kind === "TV"
      ? "TV · "
      : kind === "Speaker"
        ? "Speaker · "
        : kind === "Phone"
          ? "Phone · "
          : kind === "App"
            ? "App · "
            : client.castType === "chromecast"
              ? "Cast · "
              : client.castType === "plex"
                ? "Plex · "
                : "";
  return `${prefix}${client.name}`;
}

/** Off home LAN (or unknown): only in-app play — never offer family TVs/speakers. */
function filterClientsForNetwork(
  clients: WorkoutClient[],
  onHomeNetwork: boolean | null | undefined,
): WorkoutClient[] {
  const local =
    clients.find((c) => c.machineIdentifier === LOCAL_CLIENT_ID) ||
    LOCAL_ONLY_CLIENT;
  if (onHomeNetwork === true) {
    return clients.length ? clients : [local];
  }
  return [local];
}

function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1:
      return "Playback aborted.";
    case 2:
      return "Network error loading video (hub/Plex unreachable or stream dropped).";
    case 3:
      return "Video decode failed — format may be unsupported on this device.";
    case 4:
      return "Broken or unsupported video source (URL missing, 404, or codec not playable).";
    default:
      return "Could not play this video.";
  }
}

function WorkoutPlayer({
  playlist,
  index,
  onIndexChange,
  onClose,
  onFinished,
}: {
  playlist: PlaylistItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onFinished: () => void;
}) {
  const item = playlist[index];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState(item?.url || "");
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(
    item?.durationMs ? item.durationMs / 1000 : 0,
  );
  const [scrubbing, setScrubbing] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [externalHint, setExternalHint] = useState<string | null>(null);
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!item) return;
    setSrc(item.url);
    setCurrent(0);
    setDuration(item.durationMs ? item.durationMs / 1000 : 0);
    setPlayerError(null);
    setExternalHint(null);
  }, [item, index]);

  const playInVlc = async () => {
    if (!item?.url?.trim()) {
      setExternalHint("No stream URL to open.");
      return;
    }
    setExternalHint(null);
    try {
      const result = await openStreamInVlc(item.url);
      if (!result.opened) {
        if (result.vlcInstalled === false) {
          setExternalHint(
            "VLC is not installed. Install VLC for Android, then try again — it plays Matroska/AC3 that this built-in player can’t.",
          );
        } else {
          setExternalHint(result.message || "Could not open VLC.");
        }
      }
    } catch (err) {
      setExternalHint(err instanceof Error ? err.message : String(err));
    }
  };

  const playExternally = async () => {
    if (!item?.url?.trim()) {
      setExternalHint("No stream URL to open.");
      return;
    }
    setExternalHint(null);
    try {
      await openStreamExternally(item.url);
    } catch (err) {
      setExternalHint(err instanceof Error ? err.message : String(err));
    }
  };

  const seekTo = (seconds: number) => {
    if (!item) return;
    const video = videoRef.current;
    const target = Math.max(0, seconds);
    if (
      item.seekable !== false &&
      video &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      video.currentTime = Math.min(target, video.duration);
      setCurrent(video.currentTime);
      return;
    }
    setSrc(withStreamOffset(item.url, target));
    setCurrent(target);
  };

  if (!item) return null;

  return (
    <div className="workout-player-overlay" role="presentation">
      <div className="workout-player">
        <header className="workout-player-header">
          <div>
            <strong>
              {index === 0 ? "Warm-up" : "Workout"} · {item.title}
            </strong>
            <p className="hint" style={{ padding: 0, margin: "0.25rem 0 0" }}>
              {index + 1} of {playlist.length}
              {index === 0 ? " — warm-up first, then today’s video" : ""}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close player"
          >
            ✕
          </button>
        </header>
        {playerError && (
          <div className="err banner" style={{ margin: "0.5rem 0" }}>
            {playerError}
            {native ? (
              <span>
                {" "}
                Try <strong>Play in VLC</strong> below — hub stream is often
                Matroska, which WebView can’t decode.
              </span>
            ) : null}
          </div>
        )}
        {externalHint && (
          <div className="err banner" style={{ margin: "0.5rem 0" }}>
            {externalHint}{" "}
            {native && externalHint.includes("not installed") ? (
              <button
                type="button"
                className="btn chip"
                onClick={() => void openVlcInstallPage().catch(() => undefined)}
              >
                Get VLC
              </button>
            ) : null}
          </div>
        )}
        <video
          ref={videoRef}
          key={src}
          className="workout-player-video"
          src={src}
          controls
          autoPlay
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
            setPlayerError(null);
          }}
          onTimeUpdate={(e) => {
            if (!scrubbing) setCurrent(e.currentTarget.currentTime || 0);
          }}
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            const empty = !src.trim();
            setPlayerError(
              empty
                ? "No stream URL returned from hub."
                : `${mediaErrorMessage(code)}${
                    item.ratingKey ? ` (media ${item.ratingKey})` : ""
                  }`,
            );
          }}
          onEnded={() => {
            if (index < playlist.length - 1) onIndexChange(index + 1);
            else onFinished();
          }}
        />
        <div className="workout-player-controls">
          <button
            type="button"
            className="btn chip"
            onClick={() => seekTo(current - 10)}
          >
            −10s
          </button>
          <span className="hint" style={{ padding: 0 }}>
            {formatClock(current)} / {formatClock(duration)}
          </span>
          <button
            type="button"
            className="btn chip"
            onClick={() => seekTo(current + 10)}
          >
            +10s
          </button>
          {native && (
            <>
              <button
                type="button"
                className="btn chip"
                onClick={() => void playInVlc()}
              >
                Play in VLC
              </button>
              <button
                type="button"
                className="btn chip"
                onClick={() => void playExternally()}
              >
                Open externally
              </button>
            </>
          )}
          <input
            className="workout-scrub"
            type="range"
            min={0}
            max={Math.max(1, duration || 1)}
            step={0.5}
            value={Math.min(current, duration || 0)}
            onPointerDown={() => setScrubbing(true)}
            onPointerUp={(e) => {
              setScrubbing(false);
              seekTo(Number(e.currentTarget.value));
            }}
            onChange={(e) => setCurrent(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}

export function WorkoutsPanel({
  service,
  onBack,
  onOpenSettings,
  onHomeNetwork = null,
}: WorkoutsPanelProps) {
  const hubUrl = service.url;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hubUp, setHubUp] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<WorkoutSettings | null>(null);
  const [clients, setClients] = useState<WorkoutClient[]>([]);
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [warmup, setWarmup] = useState<WorkoutWarmup | null>(null);
  const [playingDay, setPlayingDay] = useState<number | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistItem[] | null>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [clientId, setClientId] = useState(LOCAL_CLIENT_ID);

  const configured = Boolean(
    settings?.plexTokenSet && settings.librarySectionId,
  );

  const visibleClients = useMemo(
    () => filterClientsForNetwork(clients, onHomeNetwork),
    [clients, onHomeNetwork],
  );

  const awayFromHome = onHomeNetwork !== true;

  useEffect(() => {
    if (!visibleClients.some((c) => c.machineIdentifier === clientId)) {
      setClientId(LOCAL_CLIENT_ID);
    }
  }, [visibleClients, clientId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (!hubUrl.trim()) {
        setHubUp(false);
        setSettings(null);
        setDays([]);
        setWarmup(null);
        setClients([]);
        setError(
          "Arrs Hub URL is not set. Open Settings → Network and set Arrs Hub host + port (default 3000), or set them under Workouts.",
        );
        return;
      }

      const reach = await probeHubReachable(hubUrl);
      setHubUp(reach.ok);
      if (!reach.ok) {
        setSettings(null);
        setDays([]);
        setWarmup(null);
        setClients([]);
        setError(
          `Arrs Hub unreachable — Workouts talks to hub /api/workouts/* (not Plex). Ensure Arrs Hub is running and bound for LAN (default 0.0.0.0:3000), and that Settings → Network uses host 67.84.101.14 (or LAN 10.0.0.18) with port 3000.\nTried: ${reach.triedUrl || hubUrl}\n${reach.detail}`,
        );
        return;
      }

      const loaded = await fetchWorkoutSettings(hubUrl);
      setSettings(loaded);
      setClientId(loaded.clientMachineId || LOCAL_CLIENT_ID);

      if (!loaded.plexTokenSet || !loaded.librarySectionId) {
        setDays([]);
        setWarmup(null);
        setClients([]);
        setMessage(
          "Hub is up, but Workouts isn’t configured yet. Finish Plex sign-in + library on the desktop hub, then Refresh here.",
        );
        return;
      }

      const [clientList, discover] = await Promise.all([
        fetchWorkoutClients(hubUrl),
        fetchWorkoutDiscover(hubUrl),
      ]);
      setClients(clientList);
      setDays(discover.days.filter((d) => d.day > 0));
      setWarmup(discover.warmup);
      if (discover.hint) setMessage(discover.hint);
    } catch (err) {
      setHubUp(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hubUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayButtons = useMemo(() => {
    const max = Math.max(
      settings?.dayCount || 30,
      ...days.map((d) => d.day),
      1,
    );
    return Array.from({ length: max }, (_, i) => {
      const day = i + 1;
      const found = days.find((item) => item.day === day);
      return { day, found };
    });
  }, [days, settings?.dayCount]);

  const playDay = async (day: number) => {
    setPlayingDay(day);
    setMessage(null);
    setError(null);
    try {
      let targetId = clientId;
      if (
        awayFromHome &&
        targetId !== LOCAL_CLIENT_ID
      ) {
        const ok = window.confirm(
          "You don’t appear to be on the home network. Casting to TVs/speakers remotely can interrupt family devices.\n\nPlay on This device instead?",
        );
        if (!ok) return;
        targetId = LOCAL_CLIENT_ID;
        setClientId(LOCAL_CLIENT_ID);
      }

      const result = await playWorkoutDay(hubUrl, day, targetId);
      if (result.mode === "local" && result.playlist?.length) {
        const broken = result.playlist.find((p) => !p.url?.trim());
        if (broken) {
          throw new Error(
            `Hub returned an empty stream URL for "${broken.title}". Update Arrs Hub and try again.`,
          );
        }
        setPlaylist(result.playlist);
        setPlaylistIndex(0);
        setMessage(`Playing here: ${result.warmup} → ${result.day}`);
      } else {
        setMessage(
          `Playing on ${result.client}: ${result.warmup} → ${result.day}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlayingDay(null);
    }
  };

  const closePlayer = () => {
    setPlaylist(null);
    setPlaylistIndex(0);
  };

  useAndroidBackHandler(() => {
    if (playlist) {
      closePlayer();
      return true;
    }
    return false;
  });

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id="workouts" color={service.color} size={22} />
          Workouts
        </h1>
        <button type="button" className="icon-btn" onClick={() => void load()}>
          ↻
        </button>
      </header>

      <div className="luna-subheader">
        <strong>
          {settings?.showTitle?.trim() || "Plex workouts"}
        </strong>
        <span>
          {hubUp === true
            ? configured
              ? `${days.length} days`
              : "Setup needed"
            : hubUp === false
              ? "Hub offline"
              : "…"}
        </span>
      </div>

      {error && (
        <div className="err banner">
          {error}{" "}
          <button type="button" className="btn chip" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      )}
      {message && !error && <div className="ok banner">{message}</div>}
      {loading && <p className="hint">Loading workouts from Arrs Hub…</p>}

      {!loading && hubUp && settings && (
        <div className="workouts-body">
          <p className="hint" style={{ paddingTop: "0.35rem" }}>
            Warm-up plays first, then the day you pick. Playback streams through
            Arrs Hub (not a direct Plex localhost URL).
          </p>

          {configured && (
            <label className="field workouts-play-on">
              <span>Play on</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                {visibleClients.map((client) => (
                  <option
                    key={client.machineIdentifier}
                    value={client.machineIdentifier}
                  >
                    {formatClientOption(client)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {configured && awayFromHome && (
            <p className="hint" style={{ paddingTop: 0 }}>
              Away from home — only <strong>This device</strong> is offered so
              you don’t cast to family TVs/speakers remotely.
            </p>
          )}
          {configured && onHomeNetwork === true && (
            <p className="hint" style={{ paddingTop: 0 }}>
              Home network — TVs and speakers are labeled. Prefer a TV for
              workouts.
            </p>
          )}

          {warmup ? (
            <p className="hint">
              Warm-up: <strong>{warmup.title}</strong>
            </p>
          ) : configured ? (
            <p className="hint">No warm-up match yet — check hub setup.</p>
          ) : null}

          {!configured && (
            <div className="empty-card">
              <strong>Hub needs workout setup</strong>
              <p>
                Workouts are not home-only: they need Arrs Hub online at the host
                and port in Settings → Network (default 3000). On the PC running
                the hub, open Workouts → sign in to Plex and pick the library.
                Then tap refresh here.
              </p>
            </div>
          )}

          {configured && days.length === 0 && !error && (
            <div className="empty-card">
              <strong>No day videos found</strong>
              <p>
                Hub can’t match days in the selected Plex library. Check show
                title / naming on the desktop hub, then refresh. If this stays
                empty, confirm hub host/port (home LAN or forwarded remote).
              </p>
            </div>
          )}

          {configured && (
            <div className="workout-day-grid">
              {dayButtons.map(({ day, found }) => (
                <button
                  key={day}
                  type="button"
                  className={`workout-day-btn${found ? " found" : ""}${
                    playingDay === day ? " playing" : ""
                  }`}
                  disabled={!found || playingDay !== null}
                  title={
                    found
                      ? found.title
                      : "Video not found in the selected Plex library"
                  }
                  onClick={() => void playDay(day)}
                >
                  <span className="workout-day-num">{day}</span>
                  <span className="workout-day-label">
                    {playingDay === day
                      ? "Starting…"
                      : found
                        ? "Play"
                        : "Missing"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {playlist && (
        <WorkoutPlayer
          playlist={playlist}
          index={playlistIndex}
          onIndexChange={setPlaylistIndex}
          onClose={closePlayer}
          onFinished={() => {
            closePlayer();
            setMessage("Workout finished.");
          }}
        />
      )}
    </div>
  );
}
