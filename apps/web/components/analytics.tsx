/**
 * The analytics beacon, and the reason it is a component rather than a tag in the layout.
 *
 * Both halves of the snippet — the script's origin and the site id — describe Samuel's own
 * infrastructure, so neither belongs in a tracked file. They are read from the environment
 * (`ANALYTICS_SCRIPT_URL`, `ANALYTICS_WEBSITE_ID`), documented with blank values in
 * `.env.example`, and set in the Vercel project for the deploy. A clone with neither variable
 * set renders nothing at all and works exactly as before: this returns `null` unless BOTH are
 * present, because a script with no site id would load and report nowhere.
 *
 * There is no `NEXT_PUBLIC_` prefix on purpose. This is a Server Component, so the values are
 * read where the HTML is built and only the finished tag reaches the browser; the prefix would
 * inline them into every client bundle for no gain. The consequence to know about: a statically
 * prerendered route bakes the tag at BUILD time, so changing either variable in Vercel needs a
 * redeploy, not just a restart.
 *
 * Development is excluded. `.env.local` carries the same values as production, and without this
 * gate every `npm run dev` page load would land in the real stats as `localhost`. `next start`
 * is production, which is also how the tag gets verified locally.
 */
function Analytics() {
  if (process.env.NODE_ENV !== "production") {
    return null
  }

  const src = (process.env.ANALYTICS_SCRIPT_URL ?? "").trim()
  const websiteId = (process.env.ANALYTICS_WEBSITE_ID ?? "").trim()

  if (!src || !websiteId) {
    return null
  }

  // A half-typed origin would otherwise ship a <script src="analytics.example.com/script.js">
  // that resolves against this site and 404s on every page. Fail quiet instead.
  if (!URL.canParse(src)) {
    return null
  }

  return <script defer src={src} data-website-id={websiteId} />
}

export { Analytics }
