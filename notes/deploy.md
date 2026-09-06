# Deploying Fathom

Vercel, to `fathom.samuelyahaya.com`. Written after verifying every command in this file
from a clean clone with no `.env` and no `node_modules`.

**The short version:** deploy in **fixture mode**. One environment variable, no keys, no
network in the render path. The reasoning is below and it is not laziness — a live serverless
deploy has a real architectural problem that testnet conditions make worse.

---

## 1. Deploy in fixture mode, and why

`FATHOM_FIXTURE=1` renders the board from `fixtures/board.json`, committed to the repo. Live
is the default in code; the deploy opts into the fixture.

Three reasons, in order of how much they matter.

**A live pass cannot finish inside a serverless function's budget.** One ingestion pass is
roughly 150 network round trips — ten markets, each needing an on-chain snapshot, a settlement
window, a materialized book, both sides of the per-order book, owner classification, candles,
fills and an oracle row — followed by up to two sequential model calls. Vercel's default
function timeout is 10s on Hobby and 15s on Pro. A cold pass does not fit. It can be raised to
300s, but then the first visitor waits minutes on a blank page.

**The warm cache does not survive between invocations.** `lib/venue.ts` holds its
stale-while-revalidate cache on `globalThis`, which works because a long-lived Node process
keeps it. Serverless functions are per-invocation and may be cold every time, so the cache
that makes live mode viable locally is exactly what a serverless deploy cannot provide. Every
request risks being the cold one.

**The indexer is not reliable enough to demo against.** Logged on 2026-09-05: its Postgres
went down behind a healthy GraphQL gateway, and every table read returned `504 upstream
request timeout` for hours while `{ __typename }` answered in 0.67s. A deploy pointed at live
would have shown an error page for the duration, through no fault of ours.

Fixture mode has none of these. The render touches no network, so it is fast, deterministic,
and identical every time someone opens it — which is also what you want behind a demo video.

**The honesty cost, stated plainly:** the page shows the read age in the nav, and in fixture
mode that is the age of the capture. It will say `2.1d ago` and mean it. That is correct
behaviour, not a bug — the product's whole subject is staleness — but know that a judge
opening the link will see a read that is days old. Recapture before submitting (§6).

---

## 2. One-time repo prerequisites

Already done, listed so you know they are not missing:

- **One lockfile at the root.** `bun.lock` covers all four workspaces. `package-lock.json` and
  `apps/web/bun.lock` were deleted — both were stale and workspace-unaware, and the repo could
  not be installed by anyone who cloned it. See commit `932ccc6`.
- **`packageManager: "bun@1.3.14"`** in the root `package.json`, so Vercel picks Bun rather
  than inferring a tool from whichever lockfile it finds.
- **`workspace:*` ranges** in `apps/web/package.json`. Valid for Bun; npm rejects them with
  `EUNSUPPORTEDPROTOCOL`, which is why the package manager has to be declared.

---

## 3. Vercel project setup

Import the GitHub repo, then set these. The root directory is the part people get wrong.

| Setting | Value | Why |
|---|---|---|
| **Framework Preset** | Next.js | Detected automatically |
| **Root Directory** | `apps/web` | The Next app is not at the repo root |
| **Include files outside root** | **ON** | Required: `@fathom/core`, `@fathom/ec` and `fixtures/` live above `apps/web` |
| **Install Command** | *(leave default)* | Vercel runs `bun install` from the monorepo root |
| **Build Command** | *(leave default)* | `next build` |
| **Node.js Version** | 20.x or 22.x | `engines` requires `>=20` |

That third setting is the one that breaks a build if missed. Vercel calls it *"Include files
outside of the Root Directory in the Build Step"* and it is on by default for monorepos, but
verify it — without it the workspace packages and the fixture are not in the build context, and
you get `Can't resolve '@fathom/core'`.

---

## 4. Environment variables

For a fixture deploy, exactly one:

```
FATHOM_FIXTURE=1
```

Set it for **Production, Preview and Development**. That is the whole configuration. No keys,
no venue id, no RPC URL — the fixture carries the assembled board, so nothing is read at
request time.

### If you deploy live instead

Only if you have decided to accept §1. You then need:

```
VENUE_ID=0x…          # from `npm run snapshot`, which prints every live venue. These ids MOVE.
GROQ_API_KEY=…        # optional; without it the deterministic narrator writes the prose
```

and in `apps/web/app/page.tsx` and `app/m/[id]/page.tsx` add `export const maxDuration = 300`.
`VENUE_ID` unset throws deliberately — *"One deployment hosts several venues and their markets
sit side by side in the indexer, so there is no safe default."*

**Never** set `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` on the deploy. Those are the local
Claude Code environment; a deployed project gets its own key it can rotate independently.

---

## 5. Domain: `fathom.samuelyahaya.com`

In **Project → Settings → Domains**, add `fathom.samuelyahaya.com`. Vercel gives you one
record to create at your DNS provider:

```
Type    CNAME
Name    fathom
Value   cname.vercel-dns.com
TTL     3600 (or Auto)
```

Do **not** use an A record unless Vercel explicitly asks — CNAME is correct for a subdomain and
survives IP changes on their side. If your DNS is on Cloudflare, set the record to **DNS only**
(grey cloud), not proxied: an orange-cloud proxy in front of Vercel breaks their certificate
issuance and gives you a redirect loop.

Propagation is usually under a minute, occasionally up to an hour. Vercel provisions the TLS
certificate automatically once it sees the record; the domain shows *Invalid Configuration*
until then, which is expected rather than a failure.

---

## 6. Before recording the demo: recapture the board

The committed fixture is the demo's content, so it should be a board worth showing. As of
writing it is **8 rows, all RECHECK**, captured 2026-09-04 — every verdict correct, but a board
that is one verdict eight times cannot demonstrate the engine discriminating, which is the
central claim.

```bash
npm run capture:board
```

It prints a per-market table and a tally. What you want:

- **All three verdicts present.** ALLOW, RECHECK and BLOCK. It warns when only two appear.
- **The stuck market included** — `0x…c067`, appended by id because `liveMarkets` filters
  `expiry > now` and cannot see it. It is the guaranteed BLOCK: Locked on-chain with 1503 tUSDC
  stranded past a settlement window that closed days ago, while the indexer still reports
  `clobStatus: "Trading"`. The capture **fails** rather than writing a board without it.
- **`8/8 model-explained`**, not `2/8`. The capture raises the explain budget itself.

Measured on 2026-09-05 the live board gave ALLOW 3 / RECHECK 3, so a mixed capture is
achievable — it depends on venue state. If the tally is thin, wait and run it again rather than
freezing it. Commit the result: `git add fixtures/board.json`.

Then push, and Vercel redeploys. Confirm the deployed board shows what you captured before
recording anything.

---

## 7. Verifying a deploy

```bash
curl -s https://fathom.samuelyahaya.com/api/markets | jq '{capability, usable, degraded, n: (.markets|length)}'
```

Expect `"capability": "read-only"` and a market count matching the board. That endpoint serves
the same in-memory read the pages render, so it cannot disagree with the screen.

Then open the site and check, in order:

1. The board lists markets with a mix of verdicts.
2. The nav's read age is a sane string — `2.1d ago`, not `3062m ago`.
3. A market row opens its detail page; the price step renders; the gate ladder shows which
   check decided the verdict.
4. **On a phone**, or DevTools at 375px: the board reflows to two lines per row with labelled
   figures, and does not scroll sideways.
5. The theme switch works, and both sheets (provenance, evidence) open.

---

## 8. Failure modes, and what each one means

| Symptom | Cause | Fix |
|---|---|---|
| `EUNSUPPORTEDPROTOCOL` at install | Vercel used npm, which cannot read `workspace:*` | `packageManager` missing from root `package.json` |
| `Can't resolve '@fathom/core'` | Workspace packages not in the build context | Turn on *Include files outside Root Directory* |
| `FATHOM_FIXTURE is set but … could not be read` | Fixture not in the build context, same cause | Same fix; check `fixtures/board.json` is committed |
| Function timeout / 504 on the homepage | Live mode, cold pass exceeding the budget | Set `FATHOM_FIXTURE=1`, or raise `maxDuration` |
| `VENUE_ID is not set` | Live mode without a venue | Set it from `npm run snapshot`, or use fixture mode |
| Board renders but every price chart says "too few buckets" | Fixture predates `DecisionTrace.prices` | Recapture the board |
| Domain stuck on *Invalid Configuration* | DNS not propagated, or Cloudflare proxying | Wait; set the record to DNS-only |

---

## 9. What was actually verified

Run from a fresh `git clone` to `/tmp`, with no `.env` and no `node_modules`:

- `bun install --frozen-lockfile` → **615 packages, no errors**. This is the command Vercel
  runs.
- `next build` in `apps/web` → passes. 5 routes, 4 dynamic and 1 static.
- The clone contains exactly one lockfile (`bun.lock`) and declares `bun@1.3.14`.

**Not verified**, and worth knowing: nothing here has been run on Vercel itself. The install
and build are the same commands their pipeline issues, and the settings in §3 are the ones
their monorepo documentation specifies, but the first real deploy is the first real test. The
domain steps in §5 are likewise from their documentation rather than from having pointed this
particular domain.

---

## 10. Running it locally, for the demo recording

Worth doing even with a deploy live: a local run is the fastest loop, and it is what to record
against if the network is unreliable on the day.

```bash
bun install                       # once, from the repo root
cd apps/web && npm run dev        # fixture mode, no network at all
```

`npm run dev` sets `FATHOM_FIXTURE=1` itself, so this needs no `.env` and no key. Use
`npm run dev:live` to hit the venue instead.

**Run the dev server in your own terminal, not through an agent.** Stacked Turbopack worker
pools have crashed this WSL box twice.

### The gates, if you want to show them on camera

Every one of these is read-only and sends no transactions.

| Command | What it proves | Needs network |
|---|---|---|
| `npm run test:risk` | 89 assertions over synthetic snapshots plus the frozen stuck-market fixture | no |
| `cd apps/web && npm run check:expiry` | a past-expiry row cannot render unflagged at any width | no |
| `npm run typecheck` | all four projects | no |
| `npm run snapshot` | ingestion + per-field provenance; prints every live venue | yes |
| `npm run grade` | verdicts and decision traces, with a discrimination check | yes |
| `npm run explain` | full traces, verdict integrity, and the guard proof | yes + key |
| `npm run explain -- --offline` | the same, deterministic narrator only | yes |

The two offline ones are the good demo material: `test:risk` because it grades the stuck market
from frozen evidence and asserts the verdict has not drifted since capture, and `check:expiry`
because it is a UI invariant asserted against rendered markup rather than a screenshot.

### The three things worth showing on screen

1. **The stuck market.** Chain says Locked, indexer says `Trading`, 1503 tUSDC stranded past a
   settlement window that closed over a week ago. The venue contradicting itself, checkable by
   anyone with an RPC. This is the strongest single piece of evidence in the project.
2. **The gate ladder** on a BLOCK market's detail page — it shows *which* check stopped the
   evaluation and, in hollow marks with no rail, which checks never ran. A check that did not
   run must not read as a check that passed.
3. **The price step.** Flat holds and vertical jumps, never a diagonal, because candles here are
   emitted per trade rather than per interval — so a smooth line would invent prices that never
   existed. The right edge is the read time, not the last print.

### One line worth saying out loud

The model cannot change a verdict, and not by policy — **its output schema has no verdict
field.** Deterministic code computes every number and the state machine decides; the model
writes prose about a decision that has already been made. Four guards plus a deterministic
fallback reject malformed or dishonest output rather than shipping it.

