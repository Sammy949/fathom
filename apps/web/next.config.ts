import path from "node:path"

import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // `@fathom/core` and `@fathom/ec` are workspace packages whose `main` points
  // at raw `.ts` (never built to `dist`), so Next has to compile them itself.
  transpilePackages: ["@fathom/core", "@fathom/ec"],

  // The ingestion layer runs server-side only. `@somnia-chain/markets-sdk` and
  // viem pull in Node built-ins and a WebSocket transport; keeping them external
  // to the server bundle avoids bundling a chain client that only ever runs in a
  // route handler, and guarantees the API key path never reaches the client.
  serverExternalPackages: ["@somnia-chain/markets-sdk", "viem"],

  /**
   * Ship the frozen board INTO the serverless functions that read it.
   *
   * Next decides what each function needs by tracing imports statically. `lib/venue.ts`
   * reads the fixture with `readFileSync` on a path computed at runtime, which no static
   * analysis can see — and the file lives at the MONOREPO root, outside this app — so it was
   * never copied into the lambda. Deployed, every page threw:
   *
   *   FATHOM_FIXTURE is set but /var/task/apps/web/fixtures/board.json could not be read
   *   (ENOENT ...)
   *
   * The path is relative to `outputFileTracingRoot`, and both are needed: the root has to be
   * the monorepo (matching `turbopack.root` above) or the `../../` in the glob escapes the
   * tracing base and resolves to nothing.
   *
   * Listed per-route rather than with a `**` wildcard so only the three routes that actually
   * call `getVenueRead` carry the file. A wildcard would put a ~100KB JSON into every
   * function including the ones that never read it.
   */
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  outputFileTracingIncludes: {
    "/": ["./fixtures/board.json"],
    "/m/[id]": ["./fixtures/board.json"],
    "/api/markets": ["./fixtures/board.json"],
    "/api/markets/[id]": ["./fixtures/board.json"],
  },

  turbopack: {
    // MUST be the monorepo root, not this app. `@fathom/core` and `@fathom/ec`
    // live at ../../packages, and Turbopack refuses to resolve modules outside
    // its root — pinning it to __dirname made both workspace packages
    // unresolvable ("Can't resolve '@fathom/core'") even with the symlinks in
    // place. Setting it explicitly also silences the multiple-lockfile warning
    // without guessing which one Next would have inferred.
    root: path.join(__dirname, "..", ".."),
  },
}

export default nextConfig
