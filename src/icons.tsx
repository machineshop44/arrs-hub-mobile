import type { CSSProperties, ReactNode } from "react";

import sonarrLogo from "./assets/brands/sonarr.png";
import radarrLogo from "./assets/brands/radarr.png";
import lidarrLogo from "./assets/brands/lidarr.png";
import readarrLogo from "./assets/brands/readarr.png";
import prowlarrLogo from "./assets/brands/prowlarr.png";
import whisparrLogo from "./assets/brands/whisparr.png";
import bazarrLogo from "./assets/brands/bazarr.png";
import qbittorrentLogo from "./assets/brands/qbittorrent.svg";
import sabnzbdLogo from "./assets/brands/sabnzbd.svg";
import ombiLogo from "./assets/brands/ombi.png";
import tautulliLogo from "./assets/brands/tautulli.png";
import fileflowsLogo from "./assets/brands/fileflows.png";
import plexLogo from "./assets/brands/plex.png";
import calibreLogo from "./assets/brands/calibre.svg";
import overseerrLogo from "./assets/brands/overseerr.svg";
import ytarrLogo from "./assets/brands/ytarr.svg";

type IconProps = {
  color?: string;
  size?: number;
  className?: string;
};

function Svg({
  color = "currentColor",
  size = 28,
  className,
  children,
  viewBox = "0 0 24 24",
}: IconProps & { children: ReactNode; viewBox?: string }) {
  const style: CSSProperties = { color, flexShrink: 0 };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Chrome-only: home / dashboard glyph (not a product mark). */
export function IconDashboard(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M4.8 10.8 12 4.5l7.2 6.3V19a1.4 1.4 0 0 1-1.4 1.4h-3.7v-5.2H9.9V20.4H6.2A1.4 1.4 0 0 1 4.8 19v-8.2Z"
      />
    </Svg>
  );
}

/** Chrome-only: settings gear (not a product mark). */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M10.1 2.8h3.8l.4 2.3a7.5 7.5 0 0 1 1.7.9l2.2-.9 1.9 3.3-1.8 1.4c.1.5.2 1 .2 1.5s-.1 1-.2 1.5l1.8 1.4-1.9 3.3-2.2-.9a7.5 7.5 0 0 1-1.7.9l-.4 2.3h-3.8l-.4-2.3a7.5 7.5 0 0 1-1.7-.9l-2.2.9-1.9-3.3 1.8-1.4A7.8 7.8 0 0 1 5.5 12c0-.5.1-1 .2-1.5L3.9 9.1 5.8 5.8l2.2.9a7.5 7.5 0 0 1 1.7-.9l.4-2.3ZM12 9.2A2.8 2.8 0 1 0 12 14.8 2.8 2.8 0 0 0 12 9.2Z"
      />
    </Svg>
  );
}

/** Chrome-only: power / Wake-on-LAN. */
export function IconPower(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 2.8a1.1 1.1 0 0 1 1.1 1.1v7.2a1.1 1.1 0 0 1-2.2 0V3.9A1.1 1.1 0 0 1 12 2.8Zm4.3 3.2a1 1 0 0 1 1.4.1 8.2 8.2 0 1 1-11.4 0 1 1 0 1 1 1.5-1.3 6.2 6.2 0 1 0 8.6 0 1 1 0 0 1 .9-.1Z"
      />
    </Svg>
  );
}

/** Chrome-only: show password. */
export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 5c5.2 0 9.4 3.4 10.7 7-1.3 3.6-5.5 7-10.7 7S2.6 15.6 1.3 12C2.6 8.4 6.8 5 12 5Zm0 2.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 2.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z"
      />
    </Svg>
  );
}

/** Chrome-only: hide password. */
export function IconEyeOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.3 3.3 20.7 20.7l-1.4 1.4-2.5-2.5A12.4 12.4 0 0 1 12 19c-5.2 0-9.4-3.4-10.7-7 .6-1.7 1.9-3.4 3.6-4.7L1.9 4.7 3.3 3.3ZM12 7c.6 0 1.2.1 1.7.3L11.4 9A2.6 2.6 0 0 0 9.3 11.1L7.1 8.9C8.3 7.7 10 7 12 7Zm10.7 5c-.5 1.4-1.4 2.8-2.6 3.9l-2-2A4.8 4.8 0 0 0 12.4 8.2l2.1-2.1c2.3.7 4.3 2.1 5.7 3.9.7.9 1.2 1.9 1.5 2.9Z"
      />
    </Svg>
  );
}

/** Workouts module mark (dumbbell) — not a third-party brand. */
export function IconWorkouts(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.2 9.2h1.6v5.6H3.2V9.2Zm2.4-.8h1.8v7.2H5.6V8.4Zm3 2.4h6.8v2.4H8.6v-2.4Zm7.2-2.4h1.8v7.2h-1.8V8.4Zm2.4.8H20.8v5.6h-1.6V9.2Z"
      />
    </Svg>
  );
}

/**
 * Official product marks keyed by service id.
 * Sources recorded in src/assets/brands/SOURCES.md
 */
const BRAND_SRC: Record<string, string> = {
  sonarr: sonarrLogo,
  radarr: radarrLogo,
  lidarr: lidarrLogo,
  readarr: readarrLogo,
  prowlarr: prowlarrLogo,
  whisparr: whisparrLogo,
  bazarr: bazarrLogo,
  qbittorrent: qbittorrentLogo,
  sabnzbd: sabnzbdLogo,
  ombi: ombiLogo,
  tautulli: tautulliLogo,
  fileflows: fileflowsLogo,
  plex: plexLogo,
  calibre: calibreLogo,
  overseerr: overseerrLogo,
  ytarr: ytarrLogo,
};

export function ServiceIcon({
  id,
  color,
  size = 28,
}: {
  id: string;
  color?: string;
  size?: number;
}) {
  if (id === "workouts") {
    return <IconWorkouts color={color || "#2dd4bf"} size={size} />;
  }
  const src = BRAND_SRC[id];
  if (!src) {
    return <IconDashboard size={size} />;
  }
  return (
    <img
      className="brand-icon"
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
    />
  );
}
