/**
 * Generation + in-flight guards for HomeStatusChips Plex polls.
 * Prevents stacked refresh=1 requests and ignores stale responses.
 */

export type PlexPollKind = "cached" | "refresh";

export type PlexPollTicket = {
  gen: number;
  kind: PlexPollKind;
};

export type PlexPollController = {
  /** Begin a poll. Returns null when the call should be skipped. */
  begin(kind: PlexPollKind): PlexPollTicket | null;
  /** True if this ticket still owns the latest generation. */
  isCurrent(ticket: PlexPollTicket): boolean;
  /**
   * End a poll. For refresh, only the current generation clears in-flight.
   * Returns whether UI "checking" state should clear.
   */
  end(ticket: PlexPollTicket): { clearChecking: boolean };
  readonly refreshInFlight: boolean;
  readonly generation: number;
};

export function createPlexPollController(): PlexPollController {
  let generation = 0;
  let refreshInFlight = false;

  return {
    begin(kind) {
      // Never stack a lightweight cached poll on top of a real check.
      if (kind === "cached" && refreshInFlight) return null;
      // Never stack another refresh=1 while one is already in flight.
      if (kind === "refresh" && refreshInFlight) return null;

      const gen = ++generation;
      if (kind === "refresh") refreshInFlight = true;
      return { gen, kind };
    },
    isCurrent(ticket) {
      return ticket.gen === generation;
    },
    end(ticket) {
      if (ticket.kind === "refresh") {
        if (ticket.gen === generation) {
          refreshInFlight = false;
          return { clearChecking: true };
        }
        return { clearChecking: false };
      }
      return { clearChecking: false };
    },
    get refreshInFlight() {
      return refreshInFlight;
    },
    get generation() {
      return generation;
    },
  };
}
