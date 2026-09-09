/**
 * The way-in mark: the one chevron this product draws, used wherever something opens.
 *
 * It lives in its own file because it is now used in two unrelated places — a board row's
 * link to a market, and the trigger that opens a signal's measured fields — and a mark drawn
 * twice is a mark that drifts. One drawing, one stroke weight, one silhouette.
 *
 * NOT AN ICON-PACK IMPORT, and deliberately so: `lucide` is already a dependency here. Three
 * points and a 1.5 round-capped stroke is the weight every other mark on these pages carries,
 * so the one glyph in the interface belongs to the interface rather than arriving from a
 * different drawing hand.
 *
 * THE HEIGHT IS THE ALIGNMENT, which is why it is a parameter rather than `1em`. An `<svg>`
 * is a replaced inline element, so its baseline is its own bottom edge: set the height to the
 * cap height of the type beside it and the glyph stands from the baseline to the caps,
 * landing inside their band. `align-middle` instead sits a small glyph roughly 1.5px low next
 * to caps, and "nearly centred" is the failure these pages are least allowed to make. So the
 * two callers pass what their own type needs — 10px against the 14px display face on the
 * board, 8px against the 11px mono of a `label-caps` trigger — and the `0 0 6 10` viewBox
 * scales the stroke with it, which is also why the smaller one reads a touch lighter.
 *
 * `aria-hidden` in every case. It is a mark on a control that already says what it does; a
 * screen reader should hear the control, not the decoration.
 */
export function WayIn({
  className,
  height = 10,
}: {
  className?: string
  height?: number
}) {
  return (
    <svg
      className={className}
      width={height * 0.6}
      height={height}
      viewBox="0 0 6 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 1 L5 5 L1 9" />
    </svg>
  )
}
