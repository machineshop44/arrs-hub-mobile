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
};

export function ServiceIcon({
  id,
  size = 28,
}: {
  id: string;
  color?: string;
  size?: number;
}) {
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
