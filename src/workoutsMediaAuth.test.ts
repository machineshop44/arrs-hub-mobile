import { beforeEach, describe, expect, it } from "vitest";
import { setHubApiTokenCache } from "./hubAuth";
import {
  playlistForVlc,
  withHubAuthQuery,
  withVlcDirectStreamUrl,
} from "./workoutsApi";

describe("workout media auth URLs", () => {
  beforeEach(() => {
    setHubApiTokenCache("");
  });

  it("leaves URLs unchanged when no Hub token is set", () => {
    const url = "http://hub.example:3000/api/workouts/media/42";
    expect(withHubAuthQuery(url)).toBe(url);
    expect(withVlcDirectStreamUrl(url)).toContain("mode=direct");
    expect(withVlcDirectStreamUrl(url)).not.toContain("hubToken=");
  });

  it("appends hubToken for Hub API media URLs", () => {
    setHubApiTokenCache("secret-token");
    const url = "http://hub.example:3000/api/workouts/media/42";
    const withAuth = withHubAuthQuery(url);
    expect(withAuth).toContain("hubToken=secret-token");
    const vlc = withVlcDirectStreamUrl(url);
    expect(vlc).toContain("mode=direct");
    expect(vlc).toContain("player=vlc");
    expect(vlc).toContain("hubToken=secret-token");
  });

  it("playlistForVlc stamps every item", () => {
    setHubApiTokenCache("tok");
    const items = playlistForVlc([
      {
        title: "Warm",
        ratingKey: "1",
        url: "http://hub.example:3000/api/workouts/media/1",
      },
      {
        title: "Day",
        ratingKey: "2",
        url: "http://hub.example:3000/api/workouts/media/2",
      },
    ]);
    expect(items.every((i) => i.url.includes("hubToken=tok"))).toBe(true);
  });
});
