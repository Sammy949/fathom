import { NextResponse } from "next/server"

import { getVenueRead } from "@/lib/venue"

/**
 * The agent surface. `GET /api/markets`
 *
 * WHY THIS EXISTS, and why it is twenty lines rather than a subsystem. The product
 * spec calls Fathom "agent-first, dashboard-presented", and that phrase had quietly
 * become a description of the AUDIENCE rather than of the architecture: the two
 * pages rendered `DecisionTrace` almost field-for-field, which is how token counts,
 * forty raw evidence pairs and internal signal ids ended up on a screen a person
 * reads. The agent is the ENGINE. The dashboard is for a human deciding whether to
 * act in the next minute.
 *
 * Giving the structured trace its own endpoint settles that. An agent consumes JSON
 * here; the pages are free to be a document. Neither has to pretend to be both, and
 * nothing on a page needs to exist merely because a field exists.
 *
 * It returns the same in-memory read the pages use, so a caller cannot get a
 * different verdict from the one on screen, and polling costs no extra venue
 * traffic. Read-only by construction: the venue client is opened without a signer.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const read = await getVenueRead()

    return NextResponse.json(
      {
        // Stated rather than implied. A consumer should not have to infer that
        // nothing here can place an order.
        capability: "read-only",
        venueId: read.venueId,
        assembledAt: read.assembledAt,
        assembledAtIso: new Date(read.assembledAt).toISOString(),
        /** True when at least one market was gradeable. */
        usable: read.usable,
        /** True when any read degraded or any market went ungraded. */
        degraded: read.degraded,
        counts: read.rows.reduce<Record<string, number>>(
          (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
          {},
        ),
        /** Full decision traces, keyed in board order. */
        markets: read.rows.map((r) => read.traces[r.marketId]).filter(Boolean),
        /**
         * Markets the indexer listed that could not be snapshotted at all. Surfaced
         * rather than dropped: a caller comparing this list against the venue's own
         * market count would otherwise see a silent shortfall.
         */
        failures: read.failures,
      },
      {
        // Matches the read's own TTL. A caller that polls faster than this is
        // served the same snapshot the pages are showing, which is the point.
        headers: { "cache-control": "no-store" },
      },
    )
  } catch (e) {
    // A cold-cache failure is a 503, not a 500: the venue is unreachable, the
    // service itself is fine, and a caller should retry rather than treat it as a
    // bug. The reason is named without echoing a provider body.
    return NextResponse.json(
      {
        error: "venue-unreachable",
        detail:
          "No venue read has succeeded yet and the live read failed. Retry shortly; this is an upstream outage, not a rejected request.",
        cause: e instanceof Error ? e.name : "unknown",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    )
  }
}
