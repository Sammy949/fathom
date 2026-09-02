import Link from "next/link"

import { ReadAge } from "@/components/read-age"
import { ThemeSwitch } from "@/components/theme-switch"
import { shortId } from "@/lib/format"

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
 */
export function SiteNav({
  venueId,
  network,
  assembledAt,
}: {
  venueId: string
  network: string
  assembledAt: number
}) {
  return (
    <header className="border-border border-b">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 sm:px-8">
        <Link
          href="/"
          className="font-display text-lg leading-none tracking-tight transition-colors hover:text-primary"
        >
          Fathom
        </Link>

        <span className="label-caps">
          {network} · {shortId(venueId)}
        </span>

        {/* Right cluster. Read state first, because how old the numbers are is the
            most consequential fact on a page of measurements. */}
        <div className="ml-auto flex items-center gap-x-5 gap-y-2">
          <span className="label-caps flex items-baseline gap-1.5">
            read
            <span className="font-data text-foreground text-xs normal-case tracking-normal">
              <ReadAge at={assembledAt} />
            </span>
          </span>

          {/* Stated, not implied. See the note above on why there is no wallet
              button here. */}
          <span className="label-caps" title="This dashboard opens its venue client without a signer and cannot place orders.">
            read only
          </span>

          <ThemeSwitch />
        </div>
      </nav>
    </header>
  )
}
