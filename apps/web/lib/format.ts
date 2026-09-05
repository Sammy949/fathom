/**
 * Formatters. Every figure on screen goes through one of these.
 *
 * Centralised for one reason: consistency of PRECISION. A spread rendered as
 * 0.027 in one place and 2.7 points in another reads as two different
 * measurements, and this product's entire claim is that numbers are traceable.
 * The guard in the explanation layer already rejects rescaled figures from the
 * model; the UI should hold itself to the same standard.
 */

/**
 * What a cell shows when there is no reading.
 *
 * Not an em-dash, which is the machine-written tell, and not a hyphen, which in a
 * column of signed figures reads as a minus sign. A middle dot is unambiguous and
 * matches the sounding line's own mark for a line that never found bottom, so
 * "this could not be measured" looks the same wherever it appears.
 */
export const NO_READING = "·"

/** Probability, always three decimals: the venue's tick grid resolution. */
export const prob = (v: number | null | undefined): string =>
  v === null || v === undefined ? NO_READING : v.toFixed(3)

/**
 * A spread or move, in probability POINTS.
 *
 * Points rather than a percentage of mid, deliberately: a binary contract pays 0
 * or 1, so two points of spread costs 2% of maximum payout wherever the mid
 * sits. Normalising by mid made cheap markets look catastrophic — a market at
 * mid 0.019 with a 0.021 spread scores 113% — which is why the risk engine
 * leads with absolute points too.
 */
export const points = (v: number | null | undefined, dp = 1): string =>
  v === null || v === undefined ? NO_READING : `${(v * 100).toFixed(dp)}`

/** A fraction as a percentage. For window-elapsed and coverage, never for spread. */
export const pct = (v: number | null | undefined, dp = 0): string =>
  v === null || v === undefined ? NO_READING : `${(v * 100).toFixed(dp)}%`

/** Share counts. Whole shares; the venue quotes in hundreds. */
export const shares = (v: number | null | undefined): string =>
  v === null || v === undefined ? NO_READING : Math.round(v).toLocaleString("en-US")

/**
 * A duration, in the largest unit that stays legible.
 *
 * Absolute time is deliberately paired with a window fraction wherever it
 * appears in the UI — 40 minutes since the last trade is unremarkable on a 24h
 * market and nearly terminal on a 15m one, and showing only one of the two
 * numbers is how a reader draws the wrong conclusion.
 *
 * The unit boundaries are chosen so a column of these does not mix scales badly. The
 * seconds cut is 90 rather than 60 so `89s` is not `1m`, which would round away a third
 * of the value. The minutes cut is 90 MINUTES for the same reason, but it also means an
 * hour-long window's `expires` reads `60m` while its own label reads `1h` — deliberate,
 * because a countdown wants the finer unit as it runs down and a window length wants the
 * name of its bucket.
 */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return NO_READING
  const s = Math.abs(sec)
  const sign = sec < 0 ? "-" : ""
  if (s < 90) return `${sign}${Math.round(s)}s`
  if (s < 5_400) return `${sign}${Math.round(s / 60)}m`
  if (s < 172_800) return `${sign}${(s / 3_600).toFixed(1)}h`
  return `${sign}${(s / 86_400).toFixed(1)}d`
}

/**
 * Window length as a human label. Canonical intervals are 900 / 3600 / 14400 / 86400.
 *
 * ROUNDS BEFORE CHOOSING THE UNIT, and both halves of that matter. The venue does not
 * always report a clean interval: measured on the live board, one ETH market carried
 * `intervalSec: 3598`. Dividing raw printed `59.96666666666667m` — nineteen characters
 * of false precision in a column two inches wide, next to a sibling market labelled
 * `1h`. Two seconds of difference is not a fact about a market, it is a fact about how
 * the venue computed a timestamp.
 *
 * Rounding to the minute FIRST also decides the unit correctly: 3598s is 60 minutes, so
 * it reads `1h` and lands in the same shape as the 3600s market beside it, rather than
 * `60m` which would be the same duration wearing a different label. A non-canonical
 * window that genuinely is not a round hour still shows a decimal (`1.5h`), so the
 * rounding hides noise without hiding a real difference.
 */
export function windowLabel(sec: number | null | undefined): string {
  if (!sec) return NO_READING
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hours = min / 60
  if (hours < 24) return trim(hours, "h")
  return trim(hours / 24, "d")
}

/**
 * One decimal, but only when the decimal says something.
 *
 * `25h` of window is `1.0d` without this, which claims a precision the rounding just
 * removed and puts a different number of characters in the column than the `1d` beside
 * it. A genuinely fractional window still shows its fraction.
 */
function trim(v: number, unit: string): string {
  const r = Math.round(v * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}${unit}`
}

/** Wall-clock age of a read, for the staleness indicator. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)}m ago`
}

/** Short marketId, matching how the venue's own symbols suffix them. */
export const shortId = (id: string): string => id.slice(-6)
