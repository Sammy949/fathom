import { cn } from "@/lib/utils"

/**
 * The Fathom mark: four interlocking arms folding into a centre.
 *
 * ONE PATH, TWO CONSUMERS. This component is the nav mark; `app/icon.svg` is the
 * favicon tile. Both draw the SAME `d` below, so the mark cannot drift between the
 * tab and the page - the failure mode when a logo is pasted into each place it is
 * needed. The path is the source export's, unmodified; only its frame changed.
 *
 * THE FRAME IS A CROP, NOT A TRANSFORM. The export centred the glyph inside its
 * tile to within 0.001 of a unit, so nothing here needs moving - the viewBox is the
 * glyph's own measured extents (x 76.4126, y 57.3096, 191.0324 square). What the
 * export got wrong was its CANVAS: a 344 square holding a 305.651 tile at y=0, so
 * 38.3px of baked shadow padding sat at the bottom and none at the top, and the
 * mark rendered ~6% high. Cropping to the artwork fixes that without touching a
 * coordinate.
 *
 * NO TILE, NO SHADOW. The source is an app icon - an orange squircle wrapping the
 * glyph, under two drop shadows, three inner shadows and an inset white rim
 * gradient. In a 20px nav that stack resolves to a grey smear, and a mark sitting
 * in a coloured box reads as a component-kit default rather than as a logo. The
 * tile belongs on a home screen, so it stays in the favicon and nowhere else; here
 * the glyph is bare, which is what the mark is.
 *
 * IT DOES NOT INHERIT `currentColor`, and that is deliberate. Every other small
 * element in the nav is tonal ink that flips with the theme; the mark holds
 * #EA580C in both, because a logo whose colour changes with a preference is not
 * an identity. That orange is oklch(0.646 0.194 41.1) - hue 41.1, which lands
 * between this palette's own light primary (40) and dark primary (45), so it is
 * already a member of the system rather than an accent sprayed on top. Measured
 * 3.47:1 on the light background and 5.28:1 on the dark, both clear of 3:1.
 */
export const FATHOM_MARK_VIEWBOX = "76.4126 57.3096 191.0324 191.0324"

/** The mark's single path. `app/icon.svg` draws this same geometry. */
export const FATHOM_MARK_PATH =
  "M141.911 57.3096C131.135 57.3096 120.8 61.5903 113.181 69.21L76.4126 105.978V122.808C76.4126 134.698 81.52 145.395 89.6607 152.826C81.52 160.256 76.4126 170.953 76.4126 182.843V199.673L113.181 236.441C120.8 244.061 131.135 248.342 141.911 248.342C153.801 248.342 164.498 243.234 171.929 235.094C179.359 243.234 190.056 248.342 201.946 248.342C212.723 248.342 223.057 244.061 230.677 236.441L267.445 199.673V182.843C267.445 170.953 262.337 160.256 254.197 152.826C262.337 145.395 267.445 134.698 267.445 122.808V105.978L230.677 69.21C223.057 61.5903 212.723 57.3096 201.946 57.3096C190.056 57.3096 179.359 62.417 171.929 70.5577C164.498 62.417 153.801 57.3096 141.911 57.3096ZM199.432 152.826C198.974 152.408 198.524 151.978 198.084 151.538L171.929 125.383L145.773 151.538C145.333 151.978 144.884 152.408 144.426 152.826C144.884 153.243 145.333 153.673 145.773 154.113L171.929 180.268L198.084 154.113C198.524 153.673 198.974 153.243 199.432 152.826ZM182.541 199.673V207.711C182.541 218.428 191.23 227.116 201.946 227.116C207.093 227.116 212.029 225.072 215.668 221.432L246.219 190.881V182.843C246.219 172.127 237.531 163.438 226.814 163.438C221.668 163.438 216.732 165.483 213.093 169.122L182.541 199.673ZM161.316 199.673L130.765 169.122C127.125 165.483 122.19 163.438 117.043 163.438C106.326 163.438 97.6384 172.127 97.6384 182.843V190.881L128.189 221.432C131.829 225.072 136.764 227.116 141.911 227.116C152.628 227.116 161.316 218.428 161.316 207.711V199.673ZM161.316 97.9403V105.978L130.765 136.529C127.125 140.168 122.19 142.213 117.043 142.213C106.326 142.213 97.6384 133.525 97.6384 122.808V114.77L128.189 84.2189C131.829 80.5798 136.764 78.5354 141.911 78.5354C152.628 78.5354 161.316 87.2232 161.316 97.9403ZM213.093 136.529L182.541 105.978V97.9403C182.541 87.2232 191.23 78.5354 201.946 78.5354C207.093 78.5354 212.029 80.5798 215.668 84.2189L246.219 114.77V122.808C246.219 133.525 237.531 142.213 226.814 142.213C221.668 142.213 216.732 140.168 213.093 136.529Z"

export function FathomMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={FATHOM_MARK_VIEWBOX}
      className={cn("shrink-0", className)}
      fill="#EA580C"
      // Decorative: the wordmark beside it already names the product, so announcing
      // "Fathom" twice would make a screen reader read the link as "Fathom Fathom".
      aria-hidden="true"
      focusable="false"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={FATHOM_MARK_PATH} />
    </svg>
  )
}
