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
