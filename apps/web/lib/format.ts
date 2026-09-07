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
  v === null || v === undefined
    ? NO_READING
    : Math.round(v).toLocaleString("en-US")

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
 *
 * Hours and days go through `trim`, so a whole number does not carry a decimal it has not
 * earned: `23h` rather than `23.0h`, `2d` rather than `2.0d`. A `.0` states a precision the
 * rounding just discarded, and it also makes the string one character wider than its
 * neighbours in a column sized to the content.
 */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return NO_READING
  const s = Math.abs(sec)
  const sign = sec < 0 ? "-" : ""
  if (s < 90) return `${sign}${Math.round(s)}s`
  if (s < 5_400) return `${sign}${Math.round(s / 60)}m`
  if (s < 172_800) return `${sign}${trim(s / 3_600, "h")}`
  return `${sign}${trim(s / 86_400, "d")}`
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
 * it. A genuinely fractional value still shows its fraction.
 *
 * Shared by `duration` and `windowLabel`, so the two cannot disagree about when a decimal
 * is worth printing. `duration` reimplemented `.toFixed(1)` on its own until a frozen board
 * rendered `23.0h` beside a `2d`.
 */
function trim(v: number, unit: string): string {
  const r = Math.round(v * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}${unit}`
}

/**
 * Wall-clock age of a read, for the staleness indicator.
 *
 * DELEGATES TO `duration` rather than reimplementing its tiers, which is the whole fix. It
 * used to carry two of its own — seconds, then minutes forever — so a frozen board captured
 * the previous day rendered `1062m ago`, and a week-old one would read `10080m ago`. Four
 * digits of minutes is not a duration a person parses; it is arithmetic homework. `duration`
 * already has the ladder (s → m → h → d) and is calibrated for exactly this, so the two can
 * no longer disagree about how long an hour is.
 *
 * Clamped at zero because a fixture's `assembledAt` can sit a second in the future relative
 * to a client clock, and "-1s ago" reads as a bug rather than as clock skew.
 */
export function ago(ms: number): string {
  return `${duration(Math.max(0, Math.round((Date.now() - ms) / 1000)))} ago`
}

/** Short marketId, matching how the venue's own symbols suffix them. */
export const shortId = (id: string): string => id.slice(-6)

/**
 * Is this string a market id we are willing to resolve?
 *
 * The resolver matches by SUFFIX (`full.endsWith(wanted)`), which is what lets `/m/010fad`
 * open the market whose bytes32 ends in those six characters. Unvalidated, that same rule
 * accepts any string at all — and a ONE-character id resolves whenever exactly one market
 * on the board happens to end in it. Measured against a live seven-market board, five of
 * the seven traces came back from single characters (`1`, `7`, `9`, `a`, `f`), and `0`
 * returned the `ambiguous-id` list of candidate ids.
 *
 * The disclosure is not the real problem: `/api/markets` publishes every trace by design,
 * so nothing here is secret. The problem is that a one-character id is not an IDENTIFIER.
 * Markets roll on fixed windows, so tomorrow a different market ends in `a`, and a cached
 * or bookmarked short id silently starts naming a different market while still returning
 * 200 with a confident verdict. For a product whose whole claim is that a verdict is
 * traceable to a specific market, resolving a string that cannot identify one is the
 * quiet-wrong-answer class this codebase exists to avoid — the same reason the resolver
 * already refuses an ambiguous suffix rather than picking the first hit.
 *
 * So: exactly the two forms the UI actually produces. The 6-char suffix `shortId` emits,
 * or a full 32-byte id with or without its `0x`. Anything else is rejected before the
 * board is searched, which also means an id is validated identically for a person reading
 * a page and an agent calling the API.
 */
export const isResolvableMarketId = (id: string): boolean =>
  /^(?:0x)?[0-9a-f]{64}$/i.test(id) || /^[0-9a-f]{6}$/i.test(id)
