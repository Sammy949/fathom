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

/** Window length as a human label. Intervals are 900 / 3600 / 14400 / 86400. */
export function windowLabel(sec: number | null | undefined): string {
  if (!sec) return NO_READING
  if (sec < 3_600) return `${sec / 60}m`
  if (sec < 86_400) return `${sec / 3_600}h`
  return `${sec / 86_400}d`
}

/** Wall-clock age of a read, for the staleness indicator. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)}m ago`
}

/** Short marketId, matching how the venue's own symbols suffix them. */
export const shortId = (id: string): string => id.slice(-6)
