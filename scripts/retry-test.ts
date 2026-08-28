/**
 * Proves the retry wrapper does what Stage 2 depends on it doing.
 *
 *   npm run retry:test
 *
 * The SDK's own `postGraphql` issues one `fetch` and gives up. Measured on
 * 2026-08-28, roughly one run in three died that way — `ETIMEDOUT` once,
 * `response was not JSON` minutes later from the same script — while the indexer
 * itself served 15/15 sequential and 30/30 concurrent queries cleanly. So the
 * wrapper is the fix, and it is only a fix if it actually distinguishes:
 *
 *   transient  → retry, then degrade to null (dashboard shows a stale panel)
 *   our bug    → fail immediately (a misspelled field will never resolve)
 *
 * Sends nothing and needs no key.
 */

import { loadConfig } from "@fathom/ec";
import {
  DEFAULT_RETRY,
  IndexerRejected,
  IndexerUnavailable,
  query,
  queryOrNull,
} from "@fathom/core";

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const GRN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

let failures = 0;

function check(name: string, pass: boolean, detail = ""): void {
  console.log(`  ${pass ? `${GRN}PASS${R}` : `${RED}FAIL${R}`} ${name}${detail ? ` ${DIM}${detail}${R}` : ""}`);
  if (!pass) failures++;
}

async function main(): Promise<void> {
  const { indexerUrl } = loadConfig();
  console.log(`${BOLD}Fathom — retry wrapper${R}\n${DIM}indexer ${indexerUrl}${R}\n`);

  // 1. The happy path still works.
  console.log(`${BOLD}healthy endpoint${R}`);
  const okData = await query<{ Market: { marketId: string }[] }>(
    indexerUrl,
    "RetryTestLive",
    `query RetryTestLive { Market(where: { marketType: { _eq: "BINARY" } }, limit: 3) { marketId } }`,
  );
  check("valid query returns data", okData.Market.length > 0, `${okData.Market.length} row(s)`);

  // 2. A query the server will never accept must fail FAST and LOUD. Retrying a
  //    misspelled field wastes four round-trips and then reports it as an outage,
  //    which sends you debugging the network instead of your own typo.
  console.log(`\n${BOLD}terminal failure (our bug)${R}`);
  const t0 = Date.now();
  let rejected: unknown;
  try {
    await query(
      indexerUrl,
      "RetryTestBadField",
      `query RetryTestBadField { Market(where: { marketType: { _eq: "BINARY" } }, limit: 1) { thisFieldDoesNotExist } }`,
    );
  } catch (e) {
    rejected = e;
  }
  const elapsed = Date.now() - t0;
  check("invalid field throws IndexerRejected", rejected instanceof IndexerRejected);
  check("fails without retrying", elapsed < 5_000, `${elapsed}ms`);
  if (rejected instanceof IndexerRejected) {
    console.log(`    ${DIM}${rejected.gqlMessage}${R}`);
  }

  // 3. An unreachable host is transient by nature: retry, back off, then report an
  //    outage rather than a query error.
  console.log(`\n${BOLD}transient failure (unreachable host)${R}`);
  const dead = "https://indexer.invalid.fathom-retry-test/v1/graphql";
  const fast = { ...DEFAULT_RETRY, attempts: 3, baseDelayMs: 120, maxDelayMs: 400, timeoutMs: 2_500 };
  const t1 = Date.now();
  let unavailable: unknown;
  try {
    await query(dead, "RetryTestDeadHost", `query RetryTestDeadHost { __typename }`, {}, fast);
  } catch (e) {
    unavailable = e;
  }
  const deadElapsed = Date.now() - t1;
  check("unreachable host throws IndexerUnavailable", unavailable instanceof IndexerUnavailable);
  if (unavailable instanceof IndexerUnavailable) {
    check("reports all attempts spent", unavailable.attempts === fast.attempts, `${unavailable.attempts} attempts`);
    console.log(`    ${DIM}last reason: ${unavailable.lastReason} · ${deadElapsed}ms total${R}`);
  }

  // 4. The dashboard path: degrade to null instead of throwing, so one dead panel
  //    does not blank the page.
  console.log(`\n${BOLD}graceful degradation${R}`);
  const soft = await queryOrNull(dead, "RetryTestSoft", `query RetryTestSoft { __typename }`, {}, fast);
  check("queryOrNull returns null on outage", soft === null);

  // ...but a real bug must still surface even on the soft path. Swallowing a typo
  // as "degraded" would hide it behind a stale-data badge forever.
  let softRejected: unknown;
  try {
    await queryOrNull(
      indexerUrl,
      "RetryTestSoftBad",
      `query RetryTestSoftBad { Market(limit: 1) { alsoNotAField } }`,
    );
  } catch (e) {
    softRejected = e;
  }
  check("queryOrNull still throws on our bug", softRejected instanceof IndexerRejected);

  // 5. Backoff must actually wait, or "retry" is three instant failures.
  console.log(`\n${BOLD}backoff timing${R}`);
  const slow = { ...DEFAULT_RETRY, attempts: 3, baseDelayMs: 300, maxDelayMs: 1_200, timeoutMs: 1_500 };
  const t2 = Date.now();
  await queryOrNull(dead, "RetryTestBackoff", `query RetryTestBackoff { __typename }`, {}, slow);
  const backoffElapsed = Date.now() - t2;
  // Two sleeps between three attempts, full-jitter so only a floor is meaningful.
  check("waits between attempts", backoffElapsed > 200, `${backoffElapsed}ms across ${slow.attempts} attempts`);

  console.log(`\n${BOLD}result${R}`);
  console.log(failures === 0 ? `  ${GRN}PASS${R} — retry behaves as Stage 2 requires` : `  ${RED}${failures} check(s) failed${R}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`${RED}retry test crashed${R}`);
  console.error(e);
  process.exit(1);
});
