import { MarketBoard } from "@/components/market-board"
import { ReadAge } from "@/components/read-age"
import { SiteNav } from "@/components/site-nav"
import { shortId } from "@/lib/format"
import { getVenueRead } from "@/lib/venue"

/**
 * Rendered per request, never prerendered.
 *
 * The indexer reads are deliberately `cache: "no-store"` — a stale order book
 * must never feed a risk verdict — so a static prerender is not just wrong here,
 * it fails the build outright ("couldn't be rendered statically because it used
 * no-store fetch"). Freshness is bounded by the 45s in-memory TTL in
 * `lib/venue.ts` instead, and the masthead states when the read was taken.
 */
export const dynamic = "force-dynamic"

export default async function Home() {
  const read = await getVenueRead()

  return (
    <>
      <SiteNav network="Somnia testnet" assembledAt={read.assembledAt} />
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        {/* The opening statement, not a marketing hero. Split into a headline and
            one line of deck rather than a 35-word paragraph: the claim is short
            enough to be a sentence, and the read age lives in the nav rather than
            being said twice. */}
        <header className="mb-10">
          {/* WHAT THIS IS, before what is true about it.

              The headline used to read "Every verdict here is computed in code", with the
              model's constraint beneath it. Both sentences are true and neither says what
              Fathom does: a reader who has never seen it learns that something is computed
              in code, and not that this grades prediction-market contracts for whether they
              can be traded at all. The strongest fact about a product is not the same as
              what the product is, and the first line has to be the second one.

              So: the job, the subject, and the output, in that order. Due diligence is the
              spec's own framing (a judgment layer over a prediction market, not a dashboard
              and not a trading bot), event contracts on DreamDEX is the subject, and allow /
              recheck / block is what a reader gets. The model's constraint stays, moved to
              the deck where it belongs: it is the guarantee, not the pitch. */}
          {/* `max-w-3xl`, MEASURED OFF THE FONT FILES RATHER THAN GUESSED. Read from the
              real advance widths in `public/fonts` at the sizes these render at: the
              headline sets 721.2px in Zodiak at 30px and the deck 745.5px in Instrument
              Sans at 14px, against the 672px `max-w-2xl` allowed them. So both wrapped,
              and the deck wrapped badly — 632.9px fits up to "cannot", and " change" does
              not, which stranded "change a verdict." alone on a second line. `text-wrap:
              pretty` on every `p` is supposed to prevent exactly that and did not, because
              it rebalances a rag, it does not widen a measure that is too narrow.

              768px clears both with 22px to spare, and the page's own content box is 960px
              at this breakpoint, so nothing is being pushed against the gutter. Below about
              an 832px viewport the container is narrower than 768 anyway and both lines
              wrap on their own, balanced by `text-wrap: balance` on the headline. */}
          <h1 className="font-display max-w-3xl text-3xl leading-tight">
            Due diligence for event contracts on DreamDEX.
          </h1>
          {/* EIGHTEEN WORDS, AND THE TWO CUTS ARE THE POINT.

              The deck ran 45 words across three sentences: the method, then "that decides
              the verdict: allow, recheck or block", then the model's constraint. Two of
              those three were already on the screen. The verdicts are the filter chips
              directly beneath this line and a whole column of the table under them, so
              naming them here is a caption for something the reader is looking at. The
              calibration ("compared with what is normal on this venue") is the footer's
              own note, stated there in more detail than a deck can carry.

              What is left is the pair a reader cannot get from the board itself: how many
              signals and where they come from, and the one guarantee that makes the rest
              worth reading. */}
          <p className="text-muted-foreground mt-4 max-w-3xl text-sm leading-relaxed">
            Eight signals per market, measured on chain. A language model writes the
            explanations and cannot change a verdict.
          </p>
        </header>

        {/* A FROZEN BOARD SAYS SO, above the table rather than in the chrome.

            The nav already carries the read age, and that was not enough: `12.2h ago` in a
            corner is a fact a reader can pass over, and every row underneath it still reads
            as a live market. This states the whole condition once, in prose, immediately
            before the thing it qualifies — and names WHY, because "this is a snapshot" invites
            "then why isn't it live" and the answer is architectural rather than an oversight.

            Not a pill, not a tinted chip, not an alert box with an icon. A rule and a line of
            text: the same register as the calibration note in the footer, because it is the
            same kind of statement. The `--ink-unknown` tone is the one this product already
            uses for "measured, but not a reading you can act on".

            CUT FROM 77 WORDS TO 40. The long version explained the capture architecture —
            round-trip counts, the 46s-to-four-minutes range, where to get live readings — above
            a board the reader had not looked at yet. Three facts are load-bearing and they are
            the three that survive: it is a snapshot, it is this old, and expired rows say so.
            The rest is a build note, and it lives in the README where a judge who wants it will
            look. */}
        {read.frozen ? (
          <p
            className="mb-8 border-l-2 py-1 pl-4 text-xs leading-relaxed"
            style={{ borderColor: "var(--ink-unknown)", color: "var(--muted-foreground)" }}
          >
            <span className="text-foreground">This board is a frozen snapshot</span>, captured{" "}
            <ReadAge at={read.assembledAt} className="font-data" /> and served without touching
            the venue. A live pass is ~150 round trips, too slow to hold a request open, so a
            scheduled job recaptures it. Rows past their window are marked.
          </p>
        ) : null}

        {/* The verdict tally used to sit in a `dl` above the list, restating counts
            that the filter chips now carry as their own labels. One control, one
            source of truth. */}
        <MarketBoard rows={read.rows} assembledAt={read.assembledAt} />

        {/* Ingest failures are shown, not swallowed. A market the indexer listed
            but that could not be snapshotted is a fact about the read. */}
        {read.failures.length > 0 ? (
          <section className="mt-16">
            <h2 className="section-mark mb-3">Not assessed</h2>
            <ul className="space-y-1.5">
              {read.failures.map((f) => (
                <li key={f.marketId} className="font-data text-muted-foreground text-xs">
                  {shortId(f.marketId)} · {f.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* One note, not two. The previous pair said the same thing twice: that
            thresholds are venue-calibrated, and that severity is ink rather than a
            traffic light. Both are true; the second only restated the first in
            different words, and a reader who has scrolled the table does not need
            the premise explained again. Rules dropped in favour of a gap. */}
        <footer className="text-muted-foreground mt-20 max-w-2xl space-y-3 text-xs leading-relaxed">
          <p>
            Thresholds are calibrated to this venue&apos;s measured distributions, not to
            real-money market intuitions. Spreads of 2 to 3 probability points are normal here,
            and so is a resting book that expires in twenty seconds. Confidence measures how
            completely a market could be observed, never how likely an outcome is.
          </p>
          {/* The venue id, moved down from the nav. It belongs on the page rather than in
              the chrome: this deployment hosts six venues and only one carries real event
              contracts, so WHICH venue produced these numbers is part of reading them — but
              it is checked once, not scanned, and the ids move between sessions. */}
          <p className="font-data">
            venue {shortId(read.venueId)}
            <span className="font-sans"> · operator 2, the only venue here carrying real event contracts</span>
          </p>
        </footer>
      </main>
    </>
  )
}
