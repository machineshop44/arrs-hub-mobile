import { describe, expect, it } from "vitest";
import {
  formatScheduleWhen,
  mapQueueRow,
  queueNeedsAttention,
  searchCommandFor,
} from "./arrApi";
import {
  formatEta,
  formatSpeed,
  mapQbitTorrents,
  mapSabQueue,
  parseSetCookie,
} from "./downloadsApi";
import { isLowDisk, mergeDisks } from "./homeExtras";
import {
  buildOmbiTvRequestBody,
  mapOmbiRequests,
  mapOmbiSeasons,
} from "./ombiApi";
import { plexWebUrl, serviceWebUrl } from "./plexApi";
import { mergeProwlarrIndexers } from "./prowlarrApi";
import type { ServiceConfig } from "./services";
import { transcodeReasonsFor } from "./tautulliApi";

function svc(id: string): ServiceConfig {
  return {
    id,
    name: id,
    url: "http://10.0.0.2:8989",
    apiKey: "k",
    username: "",
    password: "",
    enabled: true,
    color: "#000",
    probe: "arr",
    auth: "apiKey",
    category: "media-management",
  };
}

describe("arr queue", () => {
  it("maps progress, messages and media refs", () => {
    const item = mapQueueRow("series", {
      id: 7,
      title: "Show.S01E02.1080p",
      size: 1000,
      sizeleft: 250,
      seriesId: 3,
      episodeId: 44,
      series: { title: "Show" },
      episode: { seasonNumber: 1, episodeNumber: 2 },
      trackedDownloadState: "importPending",
      statusMessages: [{ title: "x", messages: ["No files found"] }],
      outputPath: "D:\\dl\\Show",
    });
    expect(item.progress).toBe(75);
    expect(item.messages).toEqual(["No files found"]);
    expect(item.episodeId).toBe(44);
    expect(item.seriesId).toBe(3);
    expect(queueNeedsAttention(item)).toBe(true);
  });

  it("picks the right search command per arr", () => {
    expect(searchCommandFor(svc("sonarr"), { episodeId: 5 })).toEqual({
      name: "EpisodeSearch",
      body: { episodeIds: [5] },
    });
    expect(searchCommandFor(svc("radarr"), { movieId: 9 })?.name).toBe("MoviesSearch");
    expect(searchCommandFor(svc("lidarr"), { albumId: 2 })?.name).toBe("AlbumSearch");
    expect(searchCommandFor(svc("radarr"), {})).toBeNull();
  });

  it("formats date-only releases on the same local day", () => {
    const label = formatScheduleWhen(undefined, "2026-10-03");
    expect(label).toMatch(/3/);
    expect(formatScheduleWhen()).toBe("");
  });
});

describe("tautulli transcode reasons", () => {
  it("lists video, audio and subtitle burn", () => {
    const reasons = transcodeReasonsFor({
      video_decision: "transcode",
      video_codec: "hevc",
      stream_video_codec: "h264",
      audio_decision: "transcode",
      audio_codec: "truehd",
      stream_audio_codec: "aac",
      subtitle_decision: "burn",
      subtitle_codec: "pgs",
    });
    expect(reasons.some((r) => r.startsWith("Video"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("Audio"))).toBe(true);
    expect(reasons.some((r) => r.includes("PGS"))).toBe(true);
  });

  it("is empty for direct play", () => {
    expect(transcodeReasonsFor({ video_decision: "direct play" })).toEqual([]);
  });
});

describe("plex web url", () => {
  it("adds /web to a bare server url", () => {
    expect(plexWebUrl("http://10.0.0.5:32400")).toBe("http://10.0.0.5:32400/web");
    expect(plexWebUrl("http://10.0.0.5:32400/web/index.html")).toBe(
      "http://10.0.0.5:32400/web/index.html",
    );
    expect(serviceWebUrl({ id: "sonarr", url: " http://x:8989 " })).toBe("http://x:8989");
  });
});

describe("ombi seasons + requests", () => {
  it("maps seasons and marks available / requested", () => {
    const seasons = mapOmbiSeasons({
      seasonRequests: [
        { seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
        {
          seasonNumber: 1,
          episodes: [
            { episodeNumber: 1, available: true },
            { episodeNumber: 2, available: true },
          ],
        },
        {
          seasonNumber: 2,
          episodes: [
            { episodeNumber: 1, requested: true },
            { episodeNumber: 2, requested: true },
          ],
        },
        { seasonNumber: 3, episodes: [{ episodeNumber: 1 }] },
      ],
    });
    expect(seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 3]);
    expect(seasons[0]!.available).toBe(true);
    expect(seasons[1]!.requested).toBe(true);
    expect(seasons[2]!.available || seasons[2]!.requested).toBe(false);
  });

  it("builds TV request bodies", () => {
    expect(buildOmbiTvRequestBody({ tvdbId: 5, tmdbId: null }, { type: "latest" })).toEqual({
      requestAll: false,
      firstSeason: false,
      latestSeason: true,
      tvDbId: 5,
    });
    const picked = buildOmbiTvRequestBody(
      { tvdbId: null, tmdbId: 8 },
      {
        type: "seasons",
        seasons: [{ seasonNumber: 2, episodeNumbers: [1, 2], available: false, requested: false }],
      },
    );
    expect(picked.theMovieDbId).toBe(8);
    expect(picked.seasons).toEqual([
      { seasonNumber: 2, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] },
    ]);
    expect(() =>
      buildOmbiTvRequestBody({ tvdbId: 1, tmdbId: null }, { type: "seasons", seasons: [] }),
    ).toThrow();
  });

  it("flattens TV child requests with status", () => {
    const rows = mapOmbiRequests("tv", [
      {
        title: "Show",
        posterPath: "/p.jpg",
        childRequests: [
          {
            id: 11,
            denied: true,
            deniedReason: "nope",
            requestedUser: { userName: "andrew" },
            seasonRequests: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 11,
      kind: "tv",
      status: "denied",
      requestedBy: "andrew",
      subtitle: "Seasons 1, 2",
    });
    const movies = mapOmbiRequests("movie", [{ id: 3, title: "M", approved: true }]);
    expect(movies[0]!.status).toBe("approved");
  });
});

describe("prowlarr", () => {
  it("merges status and sorts failing first", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const list = mergeProwlarrIndexers(
      [
        { id: 1, name: "Alpha", enable: true, protocol: "torrent", priority: 25 },
        { id: 2, name: "Beta", enable: true, protocol: "usenet", priority: 10 },
      ],
      [{ indexerId: 2, disabledTill: future, mostRecentFailure: "timeout" }],
    );
    expect(list.map((i) => i.name)).toEqual(["Beta", "Alpha"]);
    expect(list[0]!.disabledTill).toBe(future);
    expect(list[1]!.disabledTill).toBeNull();
  });
});

describe("download clients", () => {
  it("reads the qBittorrent session cookie", () => {
    expect(parseSetCookie("SID=abc123; HttpOnly; path=/")).toBe("SID=abc123");
    expect(parseSetCookie("QBT_SID_8080=xyz; path=/")).toBe("QBT_SID_8080=xyz");
    expect(parseSetCookie(undefined)).toBeNull();
  });

  it("maps qBittorrent torrents (skips finished idle)", () => {
    const items = mapQbitTorrents([
      { hash: "a", name: "A", progress: 0.5, dlspeed: 1024, eta: 60, state: "downloading", size: 10 },
      { hash: "b", name: "B", progress: 1, dlspeed: 0, eta: 8640000, state: "uploading", size: 10 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "a", progress: 50, etaSeconds: 60 });
  });

  it("maps the SABnzbd queue", () => {
    const state = mapSabQueue({
      queue: {
        paused: false,
        kbpersec: "2048",
        speedlimit: "50",
        slots: [{ nzo_id: "n1", filename: "File", percentage: "40", timeleft: "0:10:00", mb: "100" }],
      },
    });
    expect(state.downloadBps).toBe(2048 * 1024);
    expect(state.limited).toBe(true);
    expect(state.items[0]).toMatchObject({ key: "n1", progress: 40, etaSeconds: 600 });
  });

  it("formats speed and eta", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(5 * 1024 * 1024)).toBe("5.0 MB/s");
    expect(formatEta(3900)).toBe("1h 5m");
    expect(formatEta(null)).toBe("");
  });
});

describe("home health", () => {
  it("flags low disks and merges shared mounts", () => {
    const tb = 1024 ** 4;
    expect(isLowDisk({ freeSpace: 0.05 * tb, totalSpace: tb })).toBe(true);
    expect(isLowDisk({ freeSpace: 0.5 * tb, totalSpace: tb })).toBe(false);
    const merged = mergeDisks([
      { appName: "Sonarr", disks: [{ path: "D:\\", freeSpace: 1, totalSpace: 10 }] },
      { appName: "Radarr", disks: [{ path: "d:", freeSpace: 1, totalSpace: 10 }] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.appNames).toEqual(["Sonarr", "Radarr"]);
  });
});
