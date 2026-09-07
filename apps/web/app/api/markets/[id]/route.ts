import { NextResponse } from "next/server"

import { isResolvableMarketId } from "@/lib/format"
import { getVenueRead } from "@/lib/venue"

/**
 * One market's decision trace. `GET /api/markets/[id]`
 *
 * Accepts the short id the UI uses (`011491`) or the full bytes32, resolved by the
 * same suffix rule as the page — see `app/m/[id]/page.tsx` for why an ambiguous
 * suffix resolves to nothing rather than to a guess. An agent asking about a market
 * and a human reading about one therefore get the same answer for the same string,
 * which is the property that makes the two surfaces trustworthy together.
 */
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  /**
   * Reject the shape before searching the board. The resolver matches by suffix, so
   * without this a single character resolves whenever exactly one market ends in it —
   * five of seven traces on a live board, measured. A one-character string is not an
   * identifier: the board rolls, and the same string names a different market tomorrow
   * while still answering 200. See `isResolvableMarketId`.
   */
  if (!isResolvableMarketId(id)) {
    return NextResponse.json(
      {
        error: "malformed-id",
        detail:
          // Truncated: the id is echoed so a caller can see what was rejected, but there
          // is no reason to reflect an unbounded string back, however inert JSON is.
          `"${id.slice(0, 72)}" is not a market id. Use the 6-character short id the board ` +
          `links to (for example 010fad), or a full 32-byte id.`,
      },
      { status: 400, headers: { "cache-control": "no-store" } }
    )
  }

  let read
  try {
    read = await getVenueRead()
  } catch {
    return NextResponse.json(
      {
        error: "venue-unreachable",
        detail: "No venue read has succeeded yet. Retry shortly.",
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    )
  }

  const wanted = id.toLowerCase()
  const matches = read.rows.filter((r) => {
    const full = r.marketId.toLowerCase()
    return full === wanted || full.endsWith(wanted)
  })

  if (matches.length > 1) {
    return NextResponse.json(
      {
        error: "ambiguous-id",
        detail: `"${id}" matches ${matches.length} markets on this board. Use more of the id.`,
        candidates: matches.map((m) => m.marketId),
      },
      { status: 400, headers: { "cache-control": "no-store" } }
    )
  }

  const row = matches[0]
  const trace = row ? read.traces[row.marketId] : undefined
  if (!trace) {
    return NextResponse.json(
      {
        error: "not-found",
        detail: `No assessed market matches "${id}". Markets roll on fixed windows, so an id from an earlier board will not resolve.`,
      },
      { status: 404, headers: { "cache-control": "no-store" } }
    )
  }

  return NextResponse.json(
    { capability: "read-only", venueId: read.venueId, market: trace },
    { headers: { "cache-control": "no-store" } }
  )
}
