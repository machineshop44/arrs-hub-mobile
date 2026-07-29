import type { CSSProperties, ReactNode } from "react";

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

/** Sonarr — four-pointed star (official / LunaSea mark) */
export function IconSonarr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 1.5 13.85 9.15 21.5 11 13.85 12.85 12 20.5 10.15 12.85 2.5 11 10.15 9.15 12 1.5Z"
      />
    </Svg>
  );
}

/** Radarr — official layered play / chevron mark */
export function IconRadarr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M5.274 0C3.189.039 1.19 1.547 1.19 4.705l.184 14.518c0 1.47 1.103 2.205 2.573 2.021L3.764 3.786c0-1.654.919-1.838 2.022-1.103l14.7 8.27c1.103.734 1.655 1.47 1.838 2.756.92-1.654.552-4.043-1.286-5.33L7.991.846A4.559 4.559 0 0 0 5.274.001zm1.982 6.91-.184 10.107 9.004-5.146Zm13.598 6.064-15.068 8.82c-.92.552-2.022.736-3.124.368.918 1.47 3.307 2.389 5.145 1.47l12.68-7.35c1.102-.736 1.286-2.022.367-3.308z"
      />
    </Svg>
  );
}

/** Lidarr — lightning bolt */
export function IconLidarr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M13.5 1.8 5.8 13.5h5.2l-1.8 8.7 9.1-13.4h-5.4L13.5 1.8Z"
      />
    </Svg>
  );
}

/** Readarr — open book */
export function IconReadarr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.5 5.2c2.5-1.4 5-1.4 7.5 0V19.2c-2.5-1.3-5-1.3-7.5 0V5.2Zm9.5 0c2.5-1.4 5-1.4 7.5 0V19.2c-2.5-1.3-5-1.3-7.5 0V5.2Z"
      />
    </Svg>
  );
}

/** Prowlarr — cat-face / radar mark */
export function IconProwlarr(props: IconProps) {
  return (
    <Svg {...props}>
      <circle
        cx="12"
        cy="13"
        r="8"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      <path
        fill="currentColor"
        d="M5.2 5.5 8.4 9.2 6.6 11.1 5.2 5.5Zm13.6 0-1.4 5.6-1.8-1.9 3.2-3.7Z"
      />
      <circle cx="9.2" cy="13.2" r="1.35" fill="currentColor" />
      <circle cx="14.8" cy="13.2" r="1.35" fill="currentColor" />
      <path
        d="M9.6 16.2c.7.7 1.5 1.05 2.4 1.05s1.7-.35 2.4-1.05"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** SABnzbd — download tray */
export function IconSabnzbd(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M6 14.5h12v2.2c0 1.3-1 2.3-2.3 2.3H8.3C7 19 6 18 6 16.7v-2.2Zm5.1-9.2h1.8v6.1l2.3-2.2 1.2 1.3-4.4 4.2-4.4-4.2 1.2-1.3 2.3 2.2V5.3Z"
      />
    </Svg>
  );
}

/** qBittorrent — Q with download arrow */
export function IconQbit(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 2.5c-5.1 0-9.2 3.7-9.2 9 0 3.7 2.2 6.8 5.3 8.2l1-2.3A6.7 6.7 0 0 1 5.3 11.5c0-3.6 2.9-6.4 6.7-6.4s6.7 2.8 6.7 6.4a6.7 6.7 0 0 1-3.8 5.9l1 2.3c3.1-1.4 5.3-4.5 5.3-8.2 0-5.3-4.1-9-9.2-9Zm-1 4.8h2v5.6l2.7-2.5 1.3 1.4-4.9 4.6-4.9-4.6 1.3-1.4 2.7 2.5V7.3Z"
      />
    </Svg>
  );
}

/** Tautulli — monitoring network nodes */
export function IconTautulli(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5.5" r="2.4" fill="currentColor" />
      <circle cx="5.5" cy="16.5" r="2.4" fill="currentColor" />
      <circle cx="18.5" cy="16.5" r="2.4" fill="currentColor" />
      <path
        d="M10.4 7.2 6.9 14.3M13.6 7.2 17.1 14.3M7.9 16.5h8.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Plex — classic chevron */
export function IconPlex(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M4.074 0 0 12.131l4.074 12.132L24 12.131 4.074 0Z"
      />
    </Svg>
  );
}

/** Bazarr — subtitle speech bubble */
export function IconBazarr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.8 4.8h16.4c1.1 0 2 .9 2 2v8.2c0 1.1-.9 2-2 2H12l-3.6 3.2v-3.2H3.8c-1.1 0-2-.9-2-2V6.8c0-1.1.9-2 2-2Zm3.2 3.4v1.8h10V8.2H7Zm0 3.5v1.8h6.8v-1.8H7Z"
      />
    </Svg>
  );
}

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

export function IconOmbi(props: IconProps) {
  return (
    <Svg {...props}>
      <circle
        cx="12"
        cy="12"
        r="8.2"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      <path
        fill="currentColor"
        d="M8.2 12.8c0-2.2 1.5-3.5 3.8-3.5 1.5 0 2.5.5 3.2 1.3l-1.3 1.2c-.5-.5-1.1-.8-1.9-.8-1.2 0-2 .8-2 2s.8 2 2 2c.8 0 1.4-.3 1.9-.8l1.3 1.2c-.7.8-1.8 1.3-3.2 1.3-2.3 0-3.8-1.4-3.8-3.7Z"
      />
    </Svg>
  );
}

export function IconFileFlows(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M6 5h7l4 4v10a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 4.5 19V6.5A1.5 1.5 0 0 1 6 5Zm6.2 1.4V10H16L12.2 6.4ZM8 12.2h8v1.6H8v-1.6Zm0 3.2h5.5v1.6H8v-1.6Z"
      />
    </Svg>
  );
}

export function IconCalibre(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M6 4.8h9.2c1.3 0 2.3 1 2.3 2.3v11.5L14.8 16H6c-1.3 0-2.3-1-2.3-2.3V7.1C3.7 5.8 4.7 4.8 6 4.8Zm1.7 3.2v1.7h6.2V8H7.7Zm0 3.1v1.7h4.4v-1.7H7.7Z"
      />
    </Svg>
  );
}

export function IconOverseerr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 3.2 4.8 7v5.4c0 4.3 3 7.8 7.2 8.9 4.2-1.1 7.2-4.6 7.2-8.9V7L12 3.2Zm0 2.2 5.2 2.7v4.3c0 3.1-2.1 5.7-5.2 6.7-3.1-1-5.2-3.6-5.2-6.7V8.1L12 5.4Z"
      />
    </Svg>
  );
}

/** Whisparr — heart mark */
export function IconWhisparr(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M12 20.4S3.8 14.6 3.8 9.2C3.8 6 6.2 3.8 9 3.8c1.6 0 2.9.7 3 1.9.1-1.2 1.4-1.9 3-1.9 2.8 0 5.2 2.2 5.2 5.4 0 5.4-8.2 11.2-8.2 11.2Z"
      />
    </Svg>
  );
}

const BY_ID: Record<string, (props: IconProps) => ReactNode> = {
  sonarr: IconSonarr,
  radarr: IconRadarr,
  lidarr: IconLidarr,
  readarr: IconReadarr,
  prowlarr: IconProwlarr,
  sabnzbd: IconSabnzbd,
  qbittorrent: IconQbit,
  tautulli: IconTautulli,
  plex: IconPlex,
  bazarr: IconBazarr,
  ombi: IconOmbi,
  fileflows: IconFileFlows,
  calibre: IconCalibre,
  overseerr: IconOverseerr,
  whisparr: IconWhisparr,
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
  const Cmp = BY_ID[id] || IconDashboard;
  return <Cmp color={color} size={size} />;
}
