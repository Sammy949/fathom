/**
 * How many distinct verdicts a capture must produce before it is allowed to overwrite the
 * committed board — and when that requirement gets out of the way.
 *
 * THE PROBLEM THIS SOLVES. `FATHOM_MIN_VERDICTS` protects the board's verdict SPREAD: an
 * unattended job must not replace a board showing ALLOW/RECHECK/BLOCK with seven RECHECKs
 * because the venue rolled a generation where nothing had traded yet. That is right, and it
 * fired correctly in production on its first scheduled run. But it has no opinion about
 * FRESHNESS, so on its own it will prefer a stale three-verdict board over a fresh
 * two-verdict one indefinitely — and it did. Measured 2026-09-08 07:15Z: the deployed board
 * was 6.8 hours old with 7 of its 9 rows past expiry, both ALLOWs among them, while two
 * consecutive passes correctly refused to write anything thinner. The spread the guard was
 * protecting had by then survived only in the tally. On screen the board read as abandoned.
 *
 * So the floor is not a constant, it is a function of how stale the thing it is protecting
 * has become. Below the threshold, spread wins. Past it, freshness wins, and the floor drops
 * to `relaxedFloor` for that attempt only.
 *
 * WHY FOUR HOURS. The venue carries 1h and 1d windows. An hourly row captured at T is past
 * expiry by T+1h, so a board older than about an hour is already showing lapsed rows; what
 * survives is the daily pair. By T+4h every hourly row captured is at least three hours dead
 * and the only rows still counting down are the dailies — which in practice grade RECHECK,
 * so the board can no longer show the engine discriminating on anything live. Four hours is
 * where "the tally is still good" stops being true of the screen. It also bounds the relaxed
 * path to at most ~6 writes a day, far inside Vercel's 100 deployments/day.
 *
 * WHY THE RELAXED FLOOR IS 2 AND NOT 0. Two distinct verdicts, with BLOCK guaranteed by the
 * stuck market, is exactly "BLOCK plus at least one of ALLOW/RECHECK" — the minimum that
 * demonstrates the engine reaching different conclusions about different markets. A board of
 * one verdict shows nothing at all, and no amount of staleness makes it worth writing. The
 * other refusals are untouched by all of this: an unreachable stuck market still exits 1, and
 * a byte-identical board still costs no deploy.
 *
 * Relaxing can only ever LOWER the floor. If someone configures a floor of 2, going stale
 * does not raise it to the relaxed value.
 */

import { readFileSync } from "node:fs";

/** Once the committed board is older than this, freshness outranks spread. */
export const DEFAULT_STALE_AFTER_HOURS = 4;

/** The floor a stale board falls back to: BLOCK plus one other verdict. */
export const RELAXED_FLOOR = 2;

export type FloorDecision = {
  /** Distinct verdicts this capture must produce to be written. 0 disables the check. */
  floor: number;
  /** True when staleness lowered the floor below what was configured. */
  relaxed: boolean;
  /** Age of the board on disk in hours; null when there is no readable board. */
  ageHours: number | null;
  /** One line, printed by the capture so the decision is visible in a CI log. */
  why: string;
};

/**
 * Age of the committed board in hours, or null if there is not a readable one.
 *
 * Unreadable counts as null, which is treated as stale downstream: if we cannot prove there
 * is a good board to protect, the fresh capture is the better of the two. Bootstrapping an
 * empty repo takes the same path, which is what makes the first capture possible at all.
 */
export function committedBoardAgeHours(path: string, now: number): number | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { assembledAt?: unknown };
    const at = raw.assembledAt;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return (now - at) / 3_600_000;
  } catch {
    return null;
  }
}

export function decideFloor(opts: {
  /** `FATHOM_MIN_VERDICTS`. 0 or less disables the check entirely. */
  configured: number;
  /** Hours after which the floor relaxes. */
  staleAfterHours: number;
  /** Age of the board being protected, from `committedBoardAgeHours`. */
  ageHours: number | null;
  /** The floor to fall back to once stale. */
  relaxedFloor?: number;
}): FloorDecision {
  const { configured, staleAfterHours, ageHours } = opts;
  const relaxedFloor = opts.relaxedFloor ?? RELAXED_FLOOR;

  if (configured <= 0) {
    return { floor: 0, relaxed: false, ageHours, why: "no floor configured" };
  }

  // A board we cannot read is not a board worth protecting.
  if (ageHours === null) {
    const floor = Math.min(configured, relaxedFloor);
    return {
      floor,
      relaxed: floor < configured,
      ageHours,
      why: `no readable board on disk, so the floor is ${floor} rather than ${configured}`,
    };
  }

  if (ageHours < staleAfterHours) {
    return {
      floor: configured,
      relaxed: false,
      ageHours,
      why: `board is ${ageHours.toFixed(1)}h old, under the ${staleAfterHours}h staleness ` +
        `threshold, so spread still outranks freshness (floor ${configured})`,
    };
  }

  // Relaxation lowers a floor; it must never raise one.
  const floor = Math.min(configured, relaxedFloor);
  return {
    floor,
    relaxed: floor < configured,
    ageHours,
    why:
      floor < configured
        ? `board is ${ageHours.toFixed(1)}h old, past the ${staleAfterHours}h threshold, so ` +
          `freshness now outranks spread: floor drops ${configured} -> ${floor}`
        : `board is ${ageHours.toFixed(1)}h old, past the ${staleAfterHours}h threshold, but ` +
          `the configured floor of ${configured} is already at or below the relaxed floor`,
  };
}
