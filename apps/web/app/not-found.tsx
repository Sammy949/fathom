import Link from "next/link"

/**
 * When a market id resolves to nothing.
 *
 * `notFound()` was already being called from the detail page and landing on Next's
 * default black-and-white page, which says "404 | This page could not be found" and
 * looks like the app fell over.
 *
 * The useful thing to say here is WHY, and on this venue the reason is almost never
 * a typo: markets roll on fixed windows, so an id that resolved twenty minutes ago
 * refers to a market that has since expired and been replaced by the next one in its
 * series. That is worth explaining, because it is a fact about event contracts rather
 * than about the reader's link.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col justify-center px-6 py-16 sm:px-8">
      <p className="label-caps mb-3">not on this board</p>
      <h1 className="font-display text-2xl leading-tight">No assessed market matches that id.</h1>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        Markets here run on fixed windows and are replaced by the next in their series when they
        expire, so a link from an earlier board will not resolve. The current board is one click
        away.
      </p>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Windows shorter than fifteen minutes are also never assessed: they expire before a verdict
        can be read.
      </p>

      <Link
        href="/"
        className="text-primary mt-8 self-start text-sm underline decoration-1 underline-offset-4"
      >
        All markets
      </Link>
    </main>
  )
}
