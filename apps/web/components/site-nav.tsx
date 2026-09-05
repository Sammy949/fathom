import Link from "next/link"

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
 */
export function SiteNav({
  network,
  assembledAt,
}: {
  network: string
  assembledAt: number
}) {
  return (
    <header className="border-border border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-x-4 px-6 py-3 sm:gap-x-6 sm:px-8">
        <Link
          href="/"
          className="font-display text-lg leading-none tracking-tight transition-colors hover:text-primary"
        >
          Fathom
        </Link>

        {/* The network, in quiet sans rather than tracked caps. It names where the numbers
            come from; it is not a data label and should not dress as one. Hidden on the
            narrowest phones, where the wordmark and the read age are what matter. */}
        <span className="text-muted-foreground hidden text-xs sm:inline">{network}</span>

        {/* Right cluster. The read age is the only FIGURE in the bar, so it is the only
            thing in mono and foreground ink: how old the numbers are is the most
            consequential fact on a page of measurements, and this product grades markets on
            exactly that. */}
        <div className="ml-auto flex items-center gap-x-4 sm:gap-x-5">
          <span className="text-muted-foreground flex items-baseline gap-1.5 text-xs">
            read
            <ReadAge at={assembledAt} className="font-data text-foreground" />
          </span>

          {/* Stated in plain words, with no tooltip behind it. See the note above. */}
          <span className="text-muted-foreground text-xs">read only</span>

          <ThemeSwitch />
        </div>
      </nav>
    </header>
  )
}
