import Link from "next/link"

import { FathomMark } from "@/components/fathom-mark"
import { ReadAge } from "@/components/read-age"
import { ThemeSwitch } from "@/components/theme-switch"

/**
 * The bar across the top of every page.
 *
 * There was no navigation at all before this, which on a two-route tool reads as
 * unfinished rather than as restraint. It is treated rather than defaulted: a
 * sharp-edged rule under a single row, no pill, no floating capsule, no shadow,
 * no blur. The wordmark carries the identity in the display face; everything else
 * in the row is a fact about the read.
 *
 * WHAT IS DELIBERATELY NOT HERE: an avatar, an account menu, and a Connect Wallet
 * button. Fathom has no users to have avatars, and no settings to hide behind one.
 * More importantly the dashboard opens its exchange with `withSigner: false` on
 * purpose, so there is nothing to connect and nothing to sign with — a connect
 * button would be a control that cannot answer a click, which is worse than an
 * absence. What sits in that corner instead is the truth: this reads, it does not
 * execute. If gated execution ever lands, this is where its state belongs, and the
 * label changes from a claim about the tool to a claim about a session.
 *
 * THREE THINGS LEFT THIS BAR, and the reasons generalise.
 *
 * The VENUE ID moved to the footer. It is a real fact and not decoration — this
 * deployment hosts six venues, only one carries real event contracts, and the ids move
 * between sessions — but it is reference a reader checks once, not something scanned. It
 * now sits beside the calibration note, which is already the page's "context for these
 * numbers" block, and the nav is one item shorter on a phone for free.
 *
 * The `title=` TOOLTIP on "read only" is gone. It carried the explanation of the most
 * consequential claim in the bar in an attribute that never appears on touch — the device
 * most people will open this on. An explanation that only some readers can reach is not an
 * explanation; the phrase has to carry itself, and it does.
 *
 * ONE LABEL TREATMENT PER ROLE, not `label-caps` on everything. Three of these wore the
 * identical tracked-caps costume — the network, the word "read", and "read only" — so
 * nothing ranked against anything. Now the read age is the only figure (mono, foreground
 * ink, because it is a measurement and it moves), and the rest is quiet sans at one size.
 * When every small string looks the same the row reads as a template rather than a voice.
 *
 * THE MARK AND THE WORDMARK ARE ONE LINK, not two beside each other. Two adjacent links to
 * the same route is a duplicate stop for anyone tabbing or using a screen reader, so the
 * glyph is `aria-hidden` and the accessible name comes from the word. The mark is sized in
 * `em` against the wordmark rather than in pixels, so the pair stays locked if the type
 * scale ever changes. It is the one saturated element in an otherwise tonal bar; see
 * `fathom-mark.tsx` for why it holds its orange in both themes when nothing else does.
 */
export function SiteNav({
  network,
  assembledAt,
}: {
  network: string
  assembledAt: number
}) {
  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex max-w-5xl items-center gap-x-4 px-6 py-3 sm:gap-x-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-x-2 font-display text-lg leading-none tracking-tight transition-colors hover:text-primary"
        >
          {/* The -0.058em lift is measured, not eyeballed. `items-center` centres the mark on
              the EM BOX, but "Fathom" has no descender, so its ink stops at the baseline while
              Zodiak's descent (-260/1000) still claims its share of that box — which left the
              mark sitting 1.04px low at this size. Read off the real font metrics: with
              leading-none the baseline lands at 14.26px, caps top out at 1.66px, so the word's
              optical centre is 7.96px against the em centre's 9.00px. Expressed in em so it
              stays correct if the type scale moves. */}
          <FathomMark className="h-[1.05em] w-[1.05em] translate-y-[-0.058em]" />
          Fathom
        </Link>

        {/* The network, in quiet sans rather than tracked caps. It names where the numbers
            come from; it is not a data label and should not dress as one. Hidden on the
            narrowest phones, where the wordmark and the read age are what matter. */}
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {network}
        </span>

        {/* Right cluster. The read age is the only FIGURE in the bar, so it is the only
            thing in mono and foreground ink: how old the numbers are is the most
            consequential fact on a page of measurements, and this product grades markets on
            exactly that. */}
        <div className="ml-auto flex items-center gap-x-4 sm:gap-x-5">
          <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
            read
            <ReadAge at={assembledAt} className="font-data text-foreground" />
          </span>

          {/* Stated in plain words, with no tooltip behind it. See the note above. */}
          <span className="text-xs text-muted-foreground">read only</span>

          <ThemeSwitch />
        </div>
      </nav>
    </header>
  )
}
