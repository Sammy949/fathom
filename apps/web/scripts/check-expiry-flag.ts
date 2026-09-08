/**
 * Gate: a past-expiry row cannot render without its flag, at ANY width.
 *
 *   cd apps/web && npm run check:expiry
 *
 * Committed rather than thrown away, because this is a HARD requirement and the kind that
 * decays silently. `buildVenueRead({ alsoMarketIds })` appends markets `liveMarkets` filters
 * out (`expiry: {_gt: now}`), which is the only way a negative `secToExpiry` reaches the
 * board — and a market the venue considers over must never read as tradable. The flag is
 * keyed off `secToExpiry <= 0` rather than off which market it is, so it also fires on a
 * market that lapses between a capture and someone reading it.
 *
 * BOTH LAYOUTS ARE ASSERTED FROM ONE RENDER, and that is the actual guarantee. The table
 * reflows below `sm` — the header row hides and each figure carries its own inline label —
 * so the danger is a flag that exists in one layout and not the other. The check is that
 * the mark and the figures live in ONE cell each, with responsive `display` classes, so no
 * markup path can carry the flag while another skips it. A `sm:hidden` duplicate of the
 * figures would fail assertion 7 below.
 *
 * It runs against SYNTHETIC rows on purpose: no network, no captured fixture, so it cannot
 * go quiet when the venue changes or a fixture goes missing. It renders the real
 * `MarketList` and asserts markup, since the last three UI bugs here were invisible in code
 * and obvious in a render.
 *
 * Asserts:
 *   1. secToExpiry <= 0  -> the row carries a past-expiry mark, in the severe ink
 *   2. the mark names the lapse as a positive duration, not "-7.5d"
 *   3. the `expires` cell shows the no-reading mark, not a negative countdown
 *   4. secToExpiry > 0   -> no mark at all (the flag must not fire on live markets)
 *   5. the boundary: exactly 0 counts as expired
 *   6. the mark carries no width-conditional `display`, so it survives the reflow
 *   7. every value appears EXACTLY once per row — one markup path, not one per layout
 *   8. each figure carries an inline label that only shows below `sm`, where the header
 *      row is hidden and cannot label it
 *   9. the table does not scroll horizontally
 *  10. a FROZEN board does not recite a countdown that stopped counting
 *  11. the DETAIL page's figure obeys 1-3, 5 and 10 as well — it did not, and shipped
 *      saying "expires in 6m" for a market that had settled seven minutes earlier
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ExpiresIn } from "@/components/expires-in";
import { MarketList } from "@/components/market-list";
import { NO_READING, prob } from "@/lib/format";
import type { MarketRow } from "@/lib/venue";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";

/** The real stuck-market shape: BLOCK, nothing readable, 7.5 days past expiry. */
const expired: MarketRow = {
  marketId: `0x${"0".repeat(60)}c067`,
  symbol: "BTC-0-28AUG26-1500-C067",
  asset: "BTC",
  intervalSec: 900,
  verdict: "BLOCK",
  confidence: 0.63,
  action: "do_not_execute",
  mid: null,
  spread: null,
  lastTradeAgeSec: 646_253,
  secToExpiry: -646_253,
  quoteTtlSec: null,
  owners: 0,
  unmeasured: 3,
};

const live: MarketRow = {
  ...expired,
  marketId: `0x${"1".repeat(64)}`,
  secToExpiry: 3_600,
  verdict: "ALLOW",
};
const boundary: MarketRow = { ...expired, marketId: `0x${"2".repeat(64)}`, secToExpiry: 0 };

const failures: string[] = [];
const check = (cond: boolean, msg: string) => {
  if (!cond) failures.push(msg);
};

/**
 * The markup of one row, isolated. `[0]` is pre-table, `[1]` is the head row.
 *
 * `assembledAt` defaults to now — a board captured this instant — so most assertions read
 * `secToExpiry` at face value. Pass an older one to model a FROZEN board, which is the case
 * that actually shipped broken (see assertion 10).
 */
function rowOf(r: MarketRow, assembledAt = Date.now()): string {
  const html = renderToStaticMarkup(createElement(MarketList, { rows: [r], assembledAt }));
  return html.split(/<tr\s/)[2] ?? "";
}

/** One cell's text, with the inline mobile label stripped so only the value remains. */
const cellsOf = (row: string): string[] =>
  [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) =>
    m[1]!
      // The `label-caps` span is the mobile-only label. Drop it, or every figure cell
      // reads as "mid0.984" and the assertions below compare against the wrong string.
      .replace(/<span class="label-caps[^"]*"[^>]*>.*?<\/span>/gs, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );

/** Every `<td>` with its class attribute, for the responsive-display assertions. */
const cellClassesOf = (row: string): string[] =>
  [...row.matchAll(/<td[^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1]!);

console.log(`${BOLD}check:expiry${R} ${DIM}a past-expiry row must flag itself, at any width${R}\n`);

// ── 1 + 2 + 3: the expired row ───────────────────────────────────────────────────
const expiredRow = rowOf(expired);
check(
  expiredRow.includes("data-expired"),
  "an expired row rendered with NO past-expiry mark — it reads as a tradable market",
);
check(/past expiry/.test(expiredRow), "the mark does not say 'past expiry'");
check(
  expiredRow.includes("var(--ink-severe)"),
  "the mark is not in --ink-severe; a blocking fact must not render as a quiet one",
);

const lapse = /past expiry ([^<]+)</.exec(expiredRow)?.[1]?.trim();
check(!!lapse && !lapse.startsWith("-"), `the lapse renders as "${lapse}" — a negative duration reads as a typo`);
check(lapse === "7.5d", `expected the lapse as 7.5d, got "${lapse}"`);

const cells = cellsOf(expiredRow);
check(cells.length === 6, `expected 6 cells, got ${cells.length}`);
check(
  cells[4] === NO_READING,
  `the expires cell shows "${cells[4]}" for an expired market; a negative countdown misleads`,
);

// ── 4: a live row must be untouched ──────────────────────────────────────────────
const liveRow = rowOf(live);
check(!liveRow.includes("data-expired"), "a LIVE market was flagged past expiry — the flag fires wrongly");
check(!liveRow.includes("var(--ink-severe)"), "a live row carries severe ink it should not");
const liveCells = cellsOf(liveRow);
check(liveCells[4] === "60m", `a live market's expires cell shows "${liveCells[4]}", expected 60m`);

// ── 5: the boundary ──────────────────────────────────────────────────────────────
check(rowOf(boundary).includes("data-expired"), "secToExpiry === 0 was not treated as expired");

// ── 6: the mark must survive the reflow ──────────────────────────────────────────
// If the flag ever picks up a `hidden`/`sm:` display class it becomes width-conditional,
// which is precisely the failure this gate exists to prevent.
const markClass = /<span data-expired class="([^"]*)"/.exec(expiredRow)?.[1] ?? "";
check(
  !/\bhidden\b|\bsm:hidden\b|\bsm:block\b|\bsm:inline\b/.test(markClass),
  `the past-expiry mark carries a width-conditional display ("${markClass}") — it must show at every width`,
);

// ── 7: one markup path, not one per layout ───────────────────────────────────────
// Every value appears exactly once. A `sm:hidden` mobile duplicate of the figures would
// double these counts, and a duplicate is how the flag ends up in one layout only.
const rowText = expiredRow.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
for (const [label, needle] of [
  ["the past-expiry mark", "past expiry"],
  ["the verdict", "BLOCK"],
  ["the unmeasured count", "3 unmeasured"],
] as const) {
  const n = rowText.split(needle).length - 1;
  check(n === 1, `${label} appears ${n} times in one row; expected exactly 1 (duplicate markup path)`);
}

// A figure value, DERIVED from the row rather than hardcoded. The first version of this
// check asserted a literal "0.984" while `live.mid` was null, so it failed on a value that
// was never rendered — a bug in the gate reading as a bug in the component, for the third
// time in this file's history. Assert against `prob(live.mid)` so the two cannot drift.
const withFigure: MarketRow = { ...live, mid: 0.984 };
const figureText = rowOf(withFigure).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const midStr = prob(withFigure.mid);
const midCount = figureText.split(midStr).length - 1;
check(
  midCount === 1,
  `the mid value "${midStr}" appears ${midCount} times in one row; expected exactly 1 — the layouts are duplicating markup`,
);

// ── 8: figures are labelled where the header cannot label them ───────────────────
const figureCells = cellClassesOf(expiredRow).filter((c) => c.includes("font-data"));
check(figureCells.length === 4, `expected 4 figure cells, got ${figureCells.length}`);
for (const c of figureCells) {
  check(
    c.includes("sm:table-cell"),
    `a figure cell does not return to \`table-cell\` at sm ("${c}") — the column layout is broken`,
  );
}
const inlineLabels = [...expiredRow.matchAll(/<span class="(label-caps[^"]*)"/g)].map((m) => m[1]!);
check(
  inlineLabels.length === 4,
  `expected 4 inline figure labels for the reflow, found ${inlineLabels.length}`,
);
for (const l of inlineLabels) {
  check(
    l.includes("sm:hidden"),
    `an inline figure label does not hide at sm ("${l}") — it would duplicate the column heading`,
  );
}

// ── 9: the header row hides below sm, and the table does not scroll ──────────────
const full = renderToStaticMarkup(createElement(MarketList, { rows: [expired, live], assembledAt: Date.now() }));
check(
  /<thead[^>]*class="[^"]*hidden[^"]*sm:table-header-group/.test(full),
  "the header row does not hide below sm — six column heads cannot fit a phone",
);
check(
  !/data-slot="table-container"[^>]*overflow-x-auto/.test(full),
  "the table scrolls horizontally; the verdict would sit off-screen behind a sideways swipe",
);

// ── 10: a FROZEN board must not recite a countdown that stopped counting ─────────
// The case that actually shipped broken. Every row on the deployed board said `expires 54m`
// twelve hours after capture, because `expired` was read off the frozen `secToExpiry`
// instead of being computed against now. A market that was live AT CAPTURE and has expired
// SINCE must flag itself, or the page states a countdown for a market that has settled.
const HOUR = 3_600_000;
const wasLiveAtCapture: MarketRow = { ...live, secToExpiry: 3_600 }; // 1h left when captured
const staleRow = rowOf(wasLiveAtCapture, Date.now() - 12 * HOUR); // …read 12h later
check(
  staleRow.includes("data-expired"),
  "a market that was live at capture but has since expired is NOT flagged — the row recites a frozen countdown",
);
const staleLapse = /past expiry ([^<]+)</.exec(staleRow)?.[1]?.trim();
check(
  staleLapse === "11h",
  `expected the stale row's lapse to read 11h (12h elapsed minus the 1h it had left), got "${staleLapse}"`,
);
const staleCells = cellsOf(staleRow);
check(
  staleCells[4] === NO_READING,
  `a stale row's expires cell shows "${staleCells[4]}"; a countdown that stopped counting must not be reprinted`,
);

// And the converse: a frozen board read BEFORE its markets expire is left alone.
const stillLive = rowOf({ ...live, secToExpiry: 86_400 }, Date.now() - 1 * HOUR);
check(
  !stillLive.includes("data-expired"),
  "a market with time left after a 1h-old capture was wrongly flagged expired",
);

// ── 11: the DETAIL page's figure, which learned none of the above ───────────────
// The list has counted against the live clock since `dda18a7`. The detail page's figure
// grid did not, so the same market read `past expiry` in the table and `expires in 6m` on
// its own page — measured on the deployed `/m/017269` seven minutes after it settled. One
// fact, two surfaces, two answers. These assertions are the list's, applied one surface out.
const figureOf = (secToExpiry: number | null, assembledAt = Date.now()): string =>
  renderToStaticMarkup(createElement(ExpiresIn, { assembledAt, secToExpiry }));

/** The figure's label and value, stripped of markup. */
const partsOf = (html: string): { label: string; value: string } => {
  const ps = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((m) =>
    m[1]!.replace(/<[^>]+>/g, "").trim(),
  );
  return { label: ps[0] ?? "", value: ps[1] ?? "" };
};

const liveFig = partsOf(figureOf(3_600));
check(liveFig.label === "expires in", `a live market's figure is labelled "${liveFig.label}"`);
check(liveFig.value === "60m", `a live market's figure reads "${liveFig.value}", expected 60m`);
check(
  !figureOf(3_600).includes("var(--ink-severe)"),
  "a live market's countdown carries severe ink it should not",
);

// The case that shipped: live at capture, expired by the time it is read.
const staleFig = partsOf(figureOf(3_600, Date.now() - 12 * HOUR));
check(
  staleFig.label === "past expiry",
  `a market that expired since capture is still labelled "${staleFig.label}" — the figure recites a frozen countdown`,
);
check(
  staleFig.value === "11h",
  `expected the lapse as 11h (12h elapsed minus the 1h it had left), got "${staleFig.value}"`,
);
check(
  !staleFig.value.startsWith("-"),
  `the lapse renders as "${staleFig.value}" — a negative duration reads as a typo, not a fact`,
);
check(
  figureOf(3_600, Date.now() - 12 * HOUR).includes("var(--ink-severe)"),
  "the closed-window figure is not in --ink-severe; a blocking fact must not render as a quiet one",
);

// Already expired at capture (a market appended by id), and the boundary.
check(partsOf(figureOf(-646_253)).label === "past expiry", "a row expired AT capture is not flagged");
check(partsOf(figureOf(0)).label === "past expiry", "secToExpiry === 0 was not treated as expired");

// A missing reading is not an expired one. Collapsing the two would be the quiet
// wrong answer the product exists to avoid.
const absentFig = partsOf(figureOf(null));
check(
  absentFig.label === "expires in" && absentFig.value === NO_READING,
  `a missing expiry rendered as "${absentFig.label} / ${absentFig.value}", expected the no-reading mark`,
);

// ── report ───────────────────────────────────────────────────────────────────────
console.log(`  expired row   mark "past expiry ${lapse}", expires cell "${cells[4]}", severe ink`);
console.log(
  `  detail figure live "${liveFig.label} ${liveFig.value}", ` +
    `stale "${staleFig.label} ${staleFig.value}" in severe ink`,
);
console.log(`  live row      no mark, expires cell "${liveCells[4]}"`);
console.log(`  boundary (0)  flagged`);
console.log(`  reflow        4 figure cells, 4 sm:hidden labels, header hidden below sm`);
console.log(`  one path      every value renders exactly once per row`);

if (failures.length === 0) {
  console.log(
    `\n  ${GRN}PASS${R} a past-expiry row cannot render unflagged at any width, ` +
      `and a live row is untouched`,
  );
  process.exit(0);
}
console.log("");
for (const f of failures) console.log(`  ${RED}FAIL${R} ${f}`);
process.exit(1);
