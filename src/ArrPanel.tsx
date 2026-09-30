import { useCallback, useEffect, useMemo, useState } from "react";
import { useAndroidBackHandler } from "./androidBack";
import {
  addAndSearch,
  albumsFromLookup,
  detectArrKind,
  fetchAddProfiles,
  fetchAlbumReleases,
  fetchAlbumTracks,
  fetchArrOverview,
  fetchArrQueue,
  fetchArtistAlbums,
  fetchAuthorBooks,
  fetchBookReleases,
  fetchEpisodeReleases,
  fetchReleasesForLookup,
  fetchSeriesEpisodes,
  formatBytes,
  formatScheduleWhen,
  grabRelease,
  lookupMedia,
  MIN_AVAILABILITY_OPTIONS,
  queueNeedsAttention,
  removeQueueItem,
  retryQueueImport,
  searchAlbum,
  searchBook,
  searchCommandFor,
  searchEpisode,
  searchExisting,
  searchMediaRef,
  seasonsFromLookup,
  SONARR_MONITOR_OPTIONS,
  type ArrAddOptions,
  type ArrAddProfile,
  type ArrAlbumItem,
  type ArrBookItem,
  type ArrCalendarItem,
  type ArrEpisodeItem,
  type ArrLibraryItem,
  type ArrLookupItem,
  type ArrQueueItem,
  type ArrReleaseItem,
  type ArrTrackItem,
  type ArrWantedItem,
} from "./arrApi";
import type { ServiceConfig } from "./services";
import { useActiveInterval } from "./appActive";
import { ServiceIcon } from "./icons";
import { MediaImg, useMediaBackground } from "./mediaUrl";

function addOptionsKey(service: ServiceConfig): string {
  return `arrs-add-options-${service.id}`;
}

function loadAddOptions(service: ServiceConfig): ArrAddOptions {
  try {
    const raw = localStorage.getItem(addOptionsKey(service));
    return raw ? (JSON.parse(raw) as ArrAddOptions) : {};
  } catch {
    return {};
  }
}

type Tab = "library" | "search" | "calendar" | "missing" | "queue";
type DetailTab = "overview" | "episodes" | "albums" | "tracks" | "books";

interface ArrPanelProps {
  service: ServiceConfig;
  onBack: () => void;
  /** Open on this tab (e.g. queue from status chips → Activity). */
  initialTab?: Tab;
}

function libraryKindLabel(kind: ReturnType<typeof detectArrKind>): string {
  switch (kind) {
    case "series":
      return "Series";
    case "movie":
      return "Movies";
    case "artist":
      return "Artists";
    case "author":
      return "Authors";
    default:
      return "Library";
  }
}

function detailTitle(
  kind: ReturnType<typeof detectArrKind>,
  opts: { album?: boolean; book?: boolean; preview?: boolean },
): string {
  if (opts.album) return "Album Details";
  if (opts.book) return "Book Details";
  if (opts.preview) {
    if (kind === "artist") return "Artist Details";
    if (kind === "author") return "Author Details";
    if (kind === "movie") return "Movie Details";
    return "Series Details";
  }
  switch (kind) {
    case "movie":
      return "Movie Details";
    case "artist":
      return "Artist Details";
    case "author":
      return "Author Details";
    default:
      return "Series Details";
  }
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function libraryProgressLabel(
  kind: ReturnType<typeof detectArrKind>,
  item: ArrLibraryItem,
): string {
  const have = item.episodeFileCount ?? (item.hasFile ? 1 : 0);
  const total = item.episodeCount ?? (item.hasFile ? 1 : 0);
  const pct =
    item.percentOfEpisodes ??
    (total > 0 ? Math.round((have / total) * 100) : item.hasFile ? 100 : 0);

  if (kind === "series") return `${have}/${total} (${pct}%)`;
  if (kind === "artist") {
    const albums = item.albumCount ?? item.seasonCount;
    const tracks = item.trackCount ?? item.episodeCount;
    if (albums != null || tracks != null) {
      return `${albums ?? "—"} Albums · ${tracks ?? "—"} Tracks`;
    }
  }
  if (kind === "author") {
    const books = item.bookCount ?? item.episodeCount;
    const files = item.bookFileCount ?? item.episodeFileCount;
    if (books != null) return `${files ?? 0}/${books} books`;
  }
  return item.hasFile ? "Downloaded" : "Missing";
}

function LibrarySeriesCard({
  kind,
  item,
  onOpen,
}: {
  kind: ReturnType<typeof detectArrKind>;
  item: ArrLibraryItem;
  onOpen: (item: ArrLibraryItem) => void;
}) {
  const fanartStyle = useMediaBackground(item.fanartUrl);
  const have = item.episodeFileCount ?? (item.hasFile ? 1 : 0);
  const total = item.episodeCount ?? (item.hasFile ? 1 : 0);
  const pct =
    item.percentOfEpisodes ??
    (total > 0 ? Math.round((have / total) * 100) : item.hasFile ? 100 : 0);

  return (
    <li>
      <button
        type="button"
        className="series-card"
        style={fanartStyle}
        onClick={() => onOpen(item)}
      >
        <MediaImg src={item.posterUrl} />
        <div className="series-meta">
          <strong>{item.title}</strong>
          <span>{libraryProgressLabel(kind, item)}</span>
          <span>
            {kind === "series" && item.seasonCount
              ? `${item.seasonCount} Seasons`
              : kind === "artist" && item.sizeOnDisk
                ? formatBytes(item.sizeOnDisk)
                : item.year || ""}
            {kind !== "artist" && item.sizeOnDisk
              ? ` · ${formatBytes(item.sizeOnDisk)}`
              : ""}
          </span>
          <span>
            {[item.qualityProfile || "Any"].filter(Boolean).join(" · ")}
          </span>
          <span>
            {[item.network, item.status].filter(Boolean).join(" · ")}
          </span>
          {kind === "series" && <span className="sr-only">{pct}%</span>}
        </div>
      </button>
    </li>
  );
}

export function ArrPanel({
  service,
  onBack,
  initialTab = "library",
}: ArrPanelProps) {
  const kind = detectArrKind(service);
  const searchSupported = kind !== "unknown";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<ArrQueueItem[]>([]);
  const [wanted, setWanted] = useState<ArrWantedItem[]>([]);
  const [calendar, setCalendar] = useState<ArrCalendarItem[]>([]);
  const [library, setLibrary] = useState<ArrLibraryItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ArrLookupItem[]>([]);
  const [profiles, setProfiles] = useState<ArrAddProfile | null>(null);
  const [releasesFor, setReleasesFor] = useState<string | null>(null);
  const [releases, setReleases] = useState<ArrReleaseItem[]>([]);

  const [selected, setSelected] = useState<ArrLibraryItem | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<ArrAlbumItem | null>(null);
  const [selectedBook, setSelectedBook] = useState<ArrBookItem | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [episodes, setEpisodes] = useState<ArrEpisodeItem[]>([]);
  const [albums, setAlbums] = useState<ArrAlbumItem[]>([]);
  const [tracks, setTracks] = useState<ArrTrackItem[]>([]);
  const [books, setBooks] = useState<ArrBookItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<number | "all">("all");
  const [lookupPreview, setLookupPreview] = useState<ArrLookupItem | null>(
    null,
  );
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [addOptions, setAddOptions] = useState<ArrAddOptions>(() =>
    loadAddOptions(service),
  );

  const updateAddOptions = (patch: Partial<ArrAddOptions>) => {
    setAddOptions((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(addOptionsKey(service), JSON.stringify(next));
      } catch {
        /* storage full / disabled */
      }
      return next;
    });
  };

  /** Saved choices can go stale if a profile / folder was deleted in the arr. */
  const effectiveAddOptions = useMemo((): ArrAddOptions => {
    if (!profiles) return addOptions;
    const qp = profiles.qualityProfiles.some((p) => p.id === addOptions.qualityProfileId)
      ? addOptions.qualityProfileId
      : undefined;
    const root = profiles.rootFolders.some((r) => r.path === addOptions.rootFolderPath)
      ? addOptions.rootFolderPath
      : undefined;
    const meta = profiles.metadataProfiles?.some((p) => p.id === addOptions.metadataProfileId)
      ? addOptions.metadataProfileId
      : undefined;
    return { ...addOptions, qualityProfileId: qp, rootFolderPath: root, metadataProfileId: meta };
  }, [addOptions, profiles]);

  const refreshQueue = useCallback(async () => {
    if (!service.apiKey.trim()) return;
    try {
      setQueue(await fetchArrQueue(service));
    } catch {
      /* keep last queue; full reload surfaces errors */
    }
  }, [service]);

  useActiveInterval(() => void refreshQueue(), tab === "queue" ? 10000 : null);

  const runRowAction = async (key: string, action: () => Promise<string>) => {
    setBusyRow(key);
    setError(null);
    try {
      setMessage(await action());
      await refreshQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRow(null);
    }
  };

  const load = useCallback(async (): Promise<ArrLibraryItem[]> => {
    if (!service.apiKey.trim()) {
      setError("Add an API key in Settings for this app.");
      setLoading(false);
      return [];
    }
    setLoading(true);
    setError(null);
    try {
      const [data, addProfiles] = await Promise.all([
        fetchArrOverview(service),
        searchSupported
          ? fetchAddProfiles(service).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!data.ok) {
        setError(data.errors[0] || "Could not reach the API.");
      }
      setQueue(data.queue);
      setWanted(data.wanted ?? []);
      setCalendar(data.calendar);
      setLibrary(data.library);
      if (addProfiles) setProfiles(addProfiles);
      return data.library;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [service, searchSupported]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearReleases = () => {
    setReleases([]);
    setReleasesFor(null);
  };

  const closeDetail = () => {
    setSelected(null);
    setSelectedAlbum(null);
    setSelectedBook(null);
    setLookupPreview(null);
    setEpisodes([]);
    setAlbums([]);
    setTracks([]);
    setBooks([]);
    clearReleases();
  };

  const goBackFromDetail = () => {
    if (selectedAlbum) {
      setSelectedAlbum(null);
      setTracks([]);
      clearReleases();
      setDetailTab("albums");
      return;
    }
    if (selectedBook) {
      setSelectedBook(null);
      clearReleases();
      setDetailTab("books");
      return;
    }
    closeDetail();
  };

  useAndroidBackHandler(() => {
    if (selected || lookupPreview || selectedAlbum || selectedBook) {
      goBackFromDetail();
      return true;
    }
    return false;
  });

  const openLibraryItem = async (
    item: ArrLibraryItem,
    opts?: { detailTab?: DetailTab },
  ) => {
    setSelected(item);
    setSelectedAlbum(null);
    setSelectedBook(null);
    setLookupPreview(null);
    setDetailTab(opts?.detailTab ?? "overview");
    setSeasonFilter("all");
    clearReleases();
    setEpisodes([]);
    setAlbums([]);
    setTracks([]);
    setBooks([]);

    if (kind === "series") {
      setDetailLoading(true);
      try {
        setEpisodes(await fetchSeriesEpisodes(service, item.id));
      } catch (err) {
        setEpisodes([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
      return;
    }

    if (kind === "artist") {
      setDetailLoading(true);
      try {
        setAlbums(await fetchArtistAlbums(service, item.id));
      } catch (err) {
        setAlbums([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
      return;
    }

    if (kind === "author") {
      setDetailLoading(true);
      try {
        setBooks(await fetchAuthorBooks(service, item.id));
      } catch (err) {
        setBooks([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const openAlbum = async (album: ArrAlbumItem) => {
    setSelectedAlbum(album);
    setSelectedBook(null);
    setDetailTab("overview");
    clearReleases();
    setDetailLoading(true);
    try {
      setTracks(await fetchAlbumTracks(service, album.id));
    } catch (err) {
      setTracks([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const openBook = async (book: ArrBookItem) => {
    setSelectedBook(book);
    setSelectedAlbum(null);
    setDetailTab("overview");
    clearReleases();
  };

  const openLookupDetails = async (item: ArrLookupItem) => {
    if (item.alreadyAdded && item.addedId) {
      if (item.mediaType === "album" && kind === "artist") {
        const artistId = Number(item.raw.artistId) || 0;
        const lib = artistId
          ? library.find((l) => l.id === artistId)
          : undefined;
        if (lib) {
          setSelected(lib);
          setLookupPreview(null);
          setSelectedBook(null);
          setDetailTab("albums");
          clearReleases();
          setDetailLoading(true);
          try {
            const albumList = await fetchArtistAlbums(service, lib.id);
            setAlbums(albumList);
            const album = albumList.find((a) => a.id === item.addedId);
            if (album) {
              await openAlbum(album);
            } else {
              setSelectedAlbum(null);
            }
          } catch (err) {
            setAlbums([]);
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setDetailLoading(false);
          }
          return;
        }
      }
      if (item.mediaType === "book" && kind === "author") {
        const authorId = Number(item.raw.authorId) || 0;
        const lib = authorId
          ? library.find((l) => l.id === authorId)
          : undefined;
        if (lib) {
          setSelected(lib);
          setLookupPreview(null);
          setSelectedAlbum(null);
          setDetailTab("books");
          clearReleases();
          setDetailLoading(true);
          try {
            const bookList = await fetchAuthorBooks(service, lib.id);
            setBooks(bookList);
            const book = bookList.find((b) => b.id === item.addedId);
            if (book) await openBook(book);
            else setSelectedBook(null);
          } catch (err) {
            setBooks([]);
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setDetailLoading(false);
          }
          return;
        }
      }
      const lib = library.find((l) => l.id === item.addedId);
      if (lib) {
        await openLibraryItem(
          lib,
          kind === "series" ? { detailTab: "episodes" } : undefined,
        );
        return;
      }
    }
    setSelected(null);
    setSelectedAlbum(null);
    setSelectedBook(null);
    setLookupPreview(item);
    clearReleases();
  };

  const filteredLibrary = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return library;
    return library.filter((item) => item.title.toLowerCase().includes(q));
  }, [library, libraryFilter]);

  const seasons = useMemo(() => {
    const set = new Set(episodes.map((e) => e.seasonNumber));
    return [...set].sort((a, b) => a - b);
  }, [episodes]);

  const visibleEpisodes = useMemo(() => {
    if (seasonFilter === "all") return episodes;
    return episodes.filter((e) => e.seasonNumber === seasonFilter);
  }, [episodes, seasonFilter]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      const found = await lookupMedia(service, query);
      setResults(found);
      if (!found.length) setMessage("No results.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const findAddedLibraryItem = (
    items: ArrLibraryItem[],
    lookup: ArrLookupItem,
  ): ArrLibraryItem | undefined => {
    const title = lookup.title.trim().toLowerCase();
    return items.find(
      (row) =>
        row.title.trim().toLowerCase() === title &&
        (!lookup.year || row.year === lookup.year),
    );
  };

  const onAddSearch = async (item: ArrLookupItem) => {
    if (!profiles) {
      setError("Could not load quality profiles / root folders.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setMessage(await addAndSearch(service, item, profiles, effectiveAddOptions));
      const lib = await load();
      if (kind === "series") {
        const added = findAddedLibraryItem(lib, item);
        if (added) {
          setTab("library");
          await openLibraryItem(added, { detailTab: "episodes" });
          return;
        }
      }
      setTab("library");
      closeDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onGrab = async (release: ArrReleaseItem) => {
    setBusy(true);
    try {
      setMessage(await grabRelease(service, release));
      await load();
      setTab("queue");
      closeDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runSearchExisting = async (
    id: number,
    title: string,
    mediaType?: ArrLookupItem["mediaType"],
  ) => {
    setBusy(true);
    try {
      setMessage(
        await searchExisting(service, {
          key: String(id),
          title,
          alreadyAdded: true,
          addedId: id,
          mediaType,
          raw: { id },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const searchPlaceholder =
    kind === "movie"
      ? "Search movies…"
      : kind === "artist"
        ? "Search artists or albums…"
        : kind === "author"
          ? "Search authors or books…"
          : "Search shows…";

  if (selected || lookupPreview || selectedAlbum || selectedBook) {
    const item = selected;
    const album = selectedAlbum;
    const book = selectedBook;
    const previewSeasons = lookupPreview
      ? seasonsFromLookup(lookupPreview)
      : [];
    const previewAlbums =
      lookupPreview && lookupPreview.mediaType !== "album"
        ? albumsFromLookup(lookupPreview)
        : [];
    const heroTitle =
      album?.title ||
      book?.title ||
      item?.title ||
      lookupPreview?.title ||
      "";
    const heroOverview =
      album?.overview ||
      book?.overview ||
      item?.overview ||
      lookupPreview?.overview ||
      "";
    const heroPoster =
      album?.coverUrl || book?.coverUrl || item?.posterUrl || undefined;

    return (
      <div className="page luna-page">
        <header className="luna-top">
          <button
            type="button"
            className="icon-btn"
            onClick={goBackFromDetail}
          >
            ←
          </button>
          <h1>
            {detailTitle(kind, {
              album: Boolean(album),
              book: Boolean(book),
              preview: Boolean(lookupPreview && !item && !album && !book),
            })}
          </h1>
          <span />
        </header>

        <div className="detail-hero">
          {heroPoster ? (
            <MediaImg src={heroPoster} className="detail-poster" />
          ) : (
            <div className="detail-poster placeholder" />
          )}
          <div>
            <strong>{heroTitle}</strong>
            {lookupPreview?.subtitle && !album && !book && (
              <span className="meta">{lookupPreview.subtitle}</span>
            )}
            <p>
              {heroOverview.slice(0, 160)}
              {heroOverview.length > 160 ? "…" : ""}
            </p>
          </div>
        </div>

        {item && !album && !book && (
          <div className="detail-tabs">
            <button
              type="button"
              className={detailTab === "overview" ? "active" : ""}
              onClick={() => setDetailTab("overview")}
            >
              Overview
            </button>
            {kind === "series" && (
              <button
                type="button"
                className={detailTab === "episodes" ? "active" : ""}
                onClick={() => setDetailTab("episodes")}
              >
                Episodes
              </button>
            )}
            {kind === "artist" && (
              <button
                type="button"
                className={detailTab === "albums" ? "active" : ""}
                onClick={() => setDetailTab("albums")}
              >
                Albums
              </button>
            )}
            {kind === "author" && (
              <button
                type="button"
                className={detailTab === "books" ? "active" : ""}
                onClick={() => setDetailTab("books")}
              >
                Books
              </button>
            )}
          </div>
        )}

        {album && (
          <div className="detail-tabs">
            <button
              type="button"
              className={detailTab === "overview" ? "active" : ""}
              onClick={() => setDetailTab("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              className={detailTab === "tracks" ? "active" : ""}
              onClick={() => setDetailTab("tracks")}
            >
              Tracks
            </button>
          </div>
        )}

        {error && <p className="err banner">{error}</p>}
        {message && <p className="ok banner">{message}</p>}

        {lookupPreview && !item && !album && !book && (
          <>
            <div className="arr-item-actions">
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={() => void onAddSearch(lookupPreview)}
              >
                Add + Search
              </button>
            </div>
            {previewSeasons.length > 0 && (
              <ul className="arr-list">
                {previewSeasons.map((s) => (
                  <li key={s.seasonNumber} className="arr-item">
                    <strong>
                      {s.seasonNumber === 0
                        ? "Specials"
                        : `Season ${s.seasonNumber}`}
                    </strong>
                    <span>
                      {s.episodeCount != null
                        ? `${s.episodeCount} episodes`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {previewAlbums.length > 0 && (
              <ul className="arr-list">
                {previewAlbums.map((a, i) => (
                  <li key={`${a.title}-${i}`} className="arr-item">
                    <strong>{a.title}</strong>
                    <span>{a.year || "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {album && detailTab === "overview" && (
          <div className="detail-grid">
            <div>
              <span>MONITORING</span>
              <strong>{album.monitored ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>YEAR</span>
              <strong>{album.year || "—"}</strong>
            </div>
            <div>
              <span>TYPE</span>
              <strong>{album.albumType || "—"}</strong>
            </div>
            <div>
              <span>TRACKS</span>
              <strong>
                {album.trackFileCount != null && album.trackCount != null
                  ? `${album.trackFileCount}/${album.trackCount}`
                  : album.trackCount ?? "—"}
              </strong>
            </div>
            <div>
              <span>SIZE</span>
              <strong>{formatBytes(album.sizeOnDisk) || "—"}</strong>
            </div>
            <div>
              <span>RELEASED</span>
              <strong>
                {album.releaseDate
                  ? album.releaseDate.slice(0, 10)
                  : "—"}
              </strong>
            </div>
            <div className="arr-item-actions">
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setMessage(await searchAlbum(service, [album.id]));
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : String(err),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Search DL
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const list = await fetchAlbumReleases(service, album.id);
                    setReleasesFor(album.title);
                    setReleases(list);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : String(err),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Grab…
              </button>
            </div>
          </div>
        )}

        {album && detailTab === "tracks" && (
          <>
            {detailLoading && <p className="hint">Loading tracks…</p>}
            <ul className="arr-list">
              {tracks.map((track) => (
                <li key={track.id} className="arr-item">
                  <strong>
                    {track.trackNumber ? `${track.trackNumber}. ` : ""}
                    {track.title}
                  </strong>
                  <span>
                    {track.hasFile ? "Downloaded" : "Missing"}
                    {track.durationMs
                      ? ` · ${formatDuration(track.durationMs)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {book && (
          <div className="detail-grid">
            <div>
              <span>MONITORING</span>
              <strong>{book.monitored ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>YEAR</span>
              <strong>{book.year || "—"}</strong>
            </div>
            <div>
              <span>STATUS</span>
              <strong>{book.hasFile ? "Downloaded" : "Missing"}</strong>
            </div>
            <div>
              <span>RELEASED</span>
              <strong>
                {book.releaseDate ? book.releaseDate.slice(0, 10) : "—"}
              </strong>
            </div>
            <div className="arr-item-actions">
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setMessage(await searchBook(service, [book.id]));
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : String(err),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Search DL
              </button>
              <button
                type="button"
                className="btn chip"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const list = await fetchBookReleases(service, book.id);
                    setReleasesFor(book.title);
                    setReleases(list);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : String(err),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Grab…
              </button>
            </div>
          </div>
        )}

        {item && !album && !book && detailTab === "overview" && (
          <div className="detail-grid">
            <div>
              <span>MONITORING</span>
              <strong>{item.monitored ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>PATH</span>
              <strong>{item.path || "—"}</strong>
            </div>
            <div>
              <span>QUALITY</span>
              <strong>{item.qualityProfile || "—"}</strong>
            </div>
            <div>
              <span>STATUS</span>
              <strong>{item.status || "—"}</strong>
            </div>
            {kind === "series" && (
              <div>
                <span>NEXT AIRING</span>
                <strong>
                  {item.nextAiring
                    ? item.nextAiring.slice(0, 16).replace("T", " ")
                    : item.status === "ended"
                      ? "Series Ended"
                      : "—"}
                </strong>
              </div>
            )}
            <div>
              <span>YEAR</span>
              <strong>{item.year || "—"}</strong>
            </div>
            {kind === "series" && (
              <div>
                <span>NETWORK</span>
                <strong>{item.network || "—"}</strong>
              </div>
            )}
            {kind === "artist" && (
              <div>
                <span>ALBUMS</span>
                <strong>{item.albumCount ?? item.seasonCount ?? "—"}</strong>
              </div>
            )}
            {kind === "artist" && (
              <div>
                <span>TRACKS</span>
                <strong>
                  {item.trackFileCount != null && item.trackCount != null
                    ? `${item.trackFileCount}/${item.trackCount}`
                    : item.trackCount ?? item.episodeCount ?? "—"}
                </strong>
              </div>
            )}
            {kind === "author" && (
              <div>
                <span>BOOKS</span>
                <strong>
                  {item.bookFileCount != null && item.bookCount != null
                    ? `${item.bookFileCount}/${item.bookCount}`
                    : item.bookCount ?? item.episodeCount ?? "—"}
                </strong>
              </div>
            )}
            <div>
              <span>RUNTIME</span>
              <strong>{item.runtime ? `${item.runtime}m` : "—"}</strong>
            </div>
            <div>
              <span>RATING</span>
              <strong>{item.certification || "—"}</strong>
            </div>
            <div>
              <span>GENRES</span>
              <strong>{item.genres?.join(", ") || "—"}</strong>
            </div>
            <div>
              <span>ADDED ON</span>
              <strong>
                {item.added
                  ? new Date(item.added).toLocaleDateString()
                  : "—"}
              </strong>
            </div>
            {(kind === "movie" || kind === "artist" || kind === "author") && (
              <div className="arr-item-actions">
                <button
                  type="button"
                  className="btn chip"
                  disabled={busy}
                  onClick={() =>
                    void runSearchExisting(
                      item.id,
                      item.title,
                      kind === "artist"
                        ? "artist"
                        : kind === "author"
                          ? "author"
                          : "movie",
                    )
                  }
                >
                  Search DL
                </button>
                {kind === "movie" && (
                  <button
                    type="button"
                    className="btn chip"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const list = await fetchReleasesForLookup(service, {
                          key: String(item.id),
                          title: item.title,
                          alreadyAdded: true,
                          addedId: item.id,
                          mediaType: "movie",
                          raw: { id: item.id },
                        });
                        setReleasesFor(item.title);
                        setReleases(list);
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : String(err),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Grab…
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {item && !album && detailTab === "albums" && (
          <>
            {detailLoading && <p className="hint">Loading albums…</p>}
            <ul className="arr-list">
              {albums.map((a) => (
                <li key={a.id} className="arr-item">
                  <button
                    type="button"
                    className="arr-row-btn"
                    onClick={() => void openAlbum(a)}
                  >
                    <strong>{a.title}</strong>
                    <span>
                      {[
                        a.trackCount != null ? `${a.trackCount} Tracks` : null,
                        a.releaseDate
                          ? a.releaseDate.slice(0, 10)
                          : a.year
                            ? String(a.year)
                            : null,
                        a.trackFileCount != null &&
                        a.trackCount != null &&
                        a.trackFileCount >= a.trackCount
                          ? "Downloaded"
                          : a.trackFileCount
                            ? `${a.trackFileCount}/${a.trackCount}`
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {item && !book && detailTab === "books" && (
          <>
            {detailLoading && <p className="hint">Loading books…</p>}
            <ul className="arr-list">
              {books.map((b) => (
                <li key={b.id} className="arr-item">
                  <button
                    type="button"
                    className="arr-row-btn"
                    onClick={() => void openBook(b)}
                  >
                    <strong>{b.title}</strong>
                    <span>
                      {[
                        b.hasFile ? "Downloaded" : "Missing",
                        b.releaseDate
                          ? b.releaseDate.slice(0, 10)
                          : b.year
                            ? String(b.year)
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {item && detailTab === "episodes" && (
          <>
            {detailLoading && <p className="hint">Loading episodes…</p>}
            <div className="season-chips">
              <button
                type="button"
                className={`btn chip ${seasonFilter === "all" ? "active-chip" : ""}`}
                onClick={() => setSeasonFilter("all")}
              >
                All
              </button>
              {seasons.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn chip ${seasonFilter === s ? "active-chip" : ""}`}
                  onClick={() => setSeasonFilter(s)}
                >
                  {s === 0 ? "Specials" : `S${s}`}
                </button>
              ))}
            </div>
            <ul className="arr-list">
              {visibleEpisodes.map((ep) => (
                <li key={ep.id} className="arr-item">
                  <strong>
                    S{String(ep.seasonNumber).padStart(2, "0")}E
                    {String(ep.episodeNumber).padStart(2, "0")} · {ep.title}
                  </strong>
                  <span>
                    {ep.hasFile ? "Downloaded" : "Missing"}
                    {ep.airDate ? ` · ${ep.airDate}` : ""}
                  </span>
                  {!ep.hasFile && (
                    <div className="arr-item-actions">
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            setMessage(
                              await searchEpisode(service, [ep.id]),
                            );
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : String(err),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Search DL
                      </button>
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const list = await fetchEpisodeReleases(
                              service,
                              ep.id,
                            );
                            setReleasesFor(
                              `S${ep.seasonNumber}E${ep.episodeNumber}`,
                            );
                            setReleases(list);
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : String(err),
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Grab…
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {releasesFor && (
          <div className="releases">
            <h2>Releases · {releasesFor}</h2>
            <ul className="arr-list">
              {releases.map((release) => (
                <li key={release.guid} className="arr-item">
                  <strong>{release.title}</strong>
                  <span>
                    {[
                      release.quality,
                      formatBytes(release.size),
                      release.indexer,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="arr-item-actions">
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() => void onGrab(release)}
                    >
                      Send to DL client
                    </button>
                  </div>
                </li>
              ))}
              {!releases.length && (
                <p className="hint empty">No releases found.</p>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page luna-page">
      <header className="luna-top">
        <button type="button" className="icon-btn" onClick={onBack}>
          ←
        </button>
        <h1 className="panel-title">
          <ServiceIcon id={service.id} color={service.color} size={22} />
          {service.name}
        </h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setTab("search")}
        >
          +
        </button>
      </header>

      {tab === "library" && (
        <div className="library-toolbar">
          <input
            type="search"
            placeholder="Search…"
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
          />
        </div>
      )}

      {error && <p className="err banner">{error}</p>}
      {message && <p className="ok banner">{message}</p>}

      {tab === "library" && (
        <ul className="series-list">
          {loading && <p className="hint">Loading library…</p>}
          {!loading &&
            filteredLibrary.map((item) => (
              <LibrarySeriesCard
                key={item.id}
                kind={kind}
                item={item}
                onOpen={(next) =>
                  void openLibraryItem(
                    next,
                    kind === "series" && libraryFilter.trim()
                      ? { detailTab: "episodes" }
                      : undefined,
                  )
                }
              />
            ))}
        </ul>
      )}

      {tab === "search" && (
        <section className="search-panel">
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="btn primary tight"
              disabled={searching}
            >
              Go
            </button>
          </form>
          {profiles && (
            <details className="arr-add-options">
              <summary>Add options</summary>
              <label>
                Quality profile
                <select
                  value={effectiveAddOptions.qualityProfileId ?? ""}
                  onChange={(e) =>
                    updateAddOptions({
                      qualityProfileId: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                >
                  <option value="">Default ({profiles.qualityProfiles[0]?.name ?? "—"})</option>
                  {profiles.qualityProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Root folder
                <select
                  value={effectiveAddOptions.rootFolderPath ?? ""}
                  onChange={(e) =>
                    updateAddOptions({ rootFolderPath: e.target.value || undefined })
                  }
                >
                  <option value="">Default ({profiles.rootFolders[0]?.path ?? "—"})</option>
                  {profiles.rootFolders.map((r) => (
                    <option key={r.path} value={r.path}>
                      {r.path}
                      {typeof r.freeSpace === "number" ? ` — ${formatBytes(r.freeSpace)} free` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {profiles.metadataProfiles && profiles.metadataProfiles.length > 0 && (
                <label>
                  Metadata profile
                  <select
                    value={effectiveAddOptions.metadataProfileId ?? ""}
                    onChange={(e) =>
                      updateAddOptions({
                        metadataProfileId: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  >
                    <option value="">Default</option>
                    {profiles.metadataProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {kind === "series" && (
                <label>
                  Monitor
                  <select
                    value={effectiveAddOptions.monitor ?? "all"}
                    onChange={(e) =>
                      updateAddOptions({
                        monitor: e.target.value as ArrAddOptions["monitor"],
                      })
                    }
                  >
                    {SONARR_MONITOR_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {kind === "movie" && (
                <label>
                  Minimum availability
                  <select
                    value={effectiveAddOptions.minimumAvailability ?? "released"}
                    onChange={(e) =>
                      updateAddOptions({
                        minimumAvailability: e.target
                          .value as ArrAddOptions["minimumAvailability"],
                      })
                    }
                  >
                    {MIN_AVAILABILITY_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="arr-add-check">
                <input
                  type="checkbox"
                  checked={effectiveAddOptions.searchNow !== false}
                  onChange={(e) => updateAddOptions({ searchNow: e.target.checked })}
                />
                Search immediately after adding
              </label>
            </details>
          )}
          <ul className="arr-list">
            {results.map((item) => (
              <li key={item.key} className="arr-item">
                <button
                  type="button"
                  className="arr-row-btn"
                  onClick={() => void openLookupDetails(item)}
                >
                  <strong>
                    {item.title}
                    {item.year ? ` (${item.year})` : ""}
                  </strong>
                  <span className="meta">
                    {[
                      item.subtitle,
                      item.mediaType,
                      item.alreadyAdded ? "In library" : "Not in library",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <div className="arr-item-actions">
                  <button
                    type="button"
                    className="btn chip"
                    onClick={() => void openLookupDetails(item)}
                  >
                    Details
                  </button>
                  {!item.alreadyAdded && (
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busy}
                      onClick={() => void onAddSearch(item)}
                    >
                      Add + Search
                    </button>
                  )}
                  {item.alreadyAdded &&
                    (item.mediaType === "album" ||
                      item.mediaType === "book" ||
                      item.mediaType === "movie" ||
                      item.mediaType === "artist" ||
                      item.mediaType === "author") && (
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busy}
                        onClick={() =>
                          void runSearchExisting(
                            item.addedId!,
                            item.title,
                            item.mediaType,
                          )
                        }
                      >
                        Search DL
                      </button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "calendar" && (
        <ul className="arr-list">
          {calendar.length === 0 && (
            <p className="hint empty">Nothing in the next 14 days.</p>
          )}
          {calendar.map((item) => (
            <li key={`${item.id}-${item.airDateUtc || item.releaseDate}`} className="arr-item">
              <div className="arr-row-main">
                <strong>{item.title}</strong>
                {item.subtitle ? <span className="meta">{item.subtitle}</span> : null}
              </div>
              <span className="meta">
                {formatScheduleWhen(item.airDateUtc, item.releaseDate)}
                {item.hasFile ? " · ✓" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "missing" && (
        <ul className="arr-list">
          {wanted.length === 0 && (
            <p className="hint empty">Nothing missing right now.</p>
          )}
          {wanted.map((item) => (
            <li key={item.id} className="arr-item">
              <div className="arr-row-main">
                <strong>{item.title}</strong>
                {item.subtitle ? <span className="meta">{item.subtitle}</span> : null}
              </div>
              {searchCommandFor(service, item) ? (
                <button
                  type="button"
                  className="btn chip"
                  disabled={busyRow != null}
                  onClick={() =>
                    void runRowAction(`w-${item.id}`, () => searchMediaRef(service, item))
                  }
                >
                  {busyRow === `w-${item.id}` ? "…" : "Search"}
                </button>
              ) : (
                <span className="meta">{item.status || "Missing"}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "queue" && (
        <ul className="arr-list">
          {queue.length === 0 && <p className="hint empty">Queue is empty.</p>}
          {queue.map((item) => {
            const attention = queueNeedsAttention(item);
            const rowKey = `q-${item.id}`;
            const state = String(item.trackedDownloadState || "").toLowerCase();
            return (
              <li
                key={item.id}
                className={`arr-item arr-queue-item${attention ? " attention" : ""}`}
              >
                <div className="arr-row-main">
                  <strong>{item.mediaTitle || item.title}</strong>
                  {item.mediaTitle ? <span className="meta">{item.title}</span> : null}
                  <span className="meta">
                    {[
                      item.trackedDownloadState || item.status,
                      item.timeleft ? `${item.timeleft} left` : "",
                      item.size ? formatBytes(item.size) : "",
                      item.downloadClient,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {item.progress != null ? (
                    <div className="arr-progress" aria-label={`${item.progress}%`}>
                      <div style={{ width: `${item.progress}%` }} />
                    </div>
                  ) : null}
                  {(item.errorMessage || item.messages.length > 0) && (
                    <ul className="arr-queue-messages">
                      {[item.errorMessage, ...item.messages]
                        .filter(Boolean)
                        .slice(0, 4)
                        .map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                    </ul>
                  )}
                  <div className="arr-item-actions">
                    {state.startsWith("import") && item.outputPath ? (
                      <button
                        type="button"
                        className="btn chip primary"
                        disabled={busyRow != null}
                        onClick={() =>
                          void runRowAction(rowKey, () => retryQueueImport(service, item))
                        }
                      >
                        Retry import
                      </button>
                    ) : null}
                    {searchCommandFor(service, item) ? (
                      <button
                        type="button"
                        className="btn chip"
                        disabled={busyRow != null}
                        onClick={() =>
                          void runRowAction(rowKey, () => searchMediaRef(service, item))
                        }
                      >
                        Search again
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn chip"
                      disabled={busyRow != null}
                      onClick={() => {
                        if (!window.confirm(`Blocklist “${item.title}” and find another release?`)) return;
                        void runRowAction(rowKey, () =>
                          removeQueueItem(service, item, { blocklist: true }),
                        );
                      }}
                    >
                      Blocklist + replace
                    </button>
                    <button
                      type="button"
                      className="btn chip danger"
                      disabled={busyRow != null}
                      onClick={() => {
                        if (!window.confirm(`Remove “${item.title}” from the queue and download client?`)) return;
                        void runRowAction(rowKey, () =>
                          removeQueueItem(service, item, { blocklist: false }),
                        );
                      }}
                    >
                      {busyRow === rowKey ? "…" : "Remove"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="luna-bottom arr-bottom">
        <button
          type="button"
          className={tab === "library" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("library")}
        >
          {libraryKindLabel(kind)}
        </button>
        <button
          type="button"
          className={tab === "calendar" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("calendar")}
        >
          📅
        </button>
        <button
          type="button"
          className={tab === "missing" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("missing")}
        >
          Missing
        </button>
        <button
          type="button"
          className={tab === "queue" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("queue")}
        >
          Queue
        </button>
        <button
          type="button"
          className={tab === "search" ? "bottom-pill active" : "bottom-icon"}
          onClick={() => setTab("search")}
        >
          ⋯
        </button>
      </nav>
    </div>
  );
}
