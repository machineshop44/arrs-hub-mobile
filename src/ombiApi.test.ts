import { describe, expect, it } from "vitest";
import {
  ombiHitStatusLabel,
  ombiKindLabel,
  readForeignArtistId,
  type OmbiSearchHit,
} from "./ombiApi";

function hit(partial: Partial<OmbiSearchHit>): OmbiSearchHit {
  return {
    key: "movie-1",
    kind: "movie",
    title: "Test",
    year: "2020",
    overview: "",
    posterUrl: null,
    tmdbId: 1,
    tvdbId: null,
    foreignArtistId: null,
    foreignAlbumId: null,
    available: false,
    requested: false,
    approved: false,
    ...partial,
  };
}

describe("ombiHitStatusLabel", () => {
  it("prefers available over requested", () => {
    expect(ombiHitStatusLabel(hit({ available: true, requested: true }))).toBe(
      "Available",
    );
  });

  it("shows requested / approved / not requested", () => {
    expect(ombiHitStatusLabel(hit({ approved: true }))).toBe("Approved");
    expect(ombiHitStatusLabel(hit({ requested: true }))).toBe("Requested");
    expect(ombiHitStatusLabel(hit({}))).toBe("Not requested");
  });
});

describe("ombiKindLabel", () => {
  it("labels kinds", () => {
    expect(ombiKindLabel("movie")).toBe("Movie");
    expect(ombiKindLabel("tv")).toBe("TV");
    expect(ombiKindLabel("music")).toBe("Music");
  });
});

describe("readForeignArtistId", () => {
  it("reads Ombi's misspelled ForignArtistId field", () => {
    expect(
      readForeignArtistId({
        artistName: "Taylor Swift",
        forignArtistId: "mbid-taylor",
      }),
    ).toBe("mbid-taylor");
  });

  it("prefers correctly spelled foreignArtistId when present", () => {
    expect(
      readForeignArtistId({
        foreignArtistId: "correct",
        forignArtistId: "typo",
      }),
    ).toBe("correct");
  });
});
