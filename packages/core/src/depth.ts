/**
 * Depth durability — who owns the displayed book, and how long it lives.
 *
 * This is the one measure in Fathom with NO off-chain equivalent, and the reason
 * is mechanical: `getAllOpenOrdersOffChain` carries `owner` and
 * `expireTimestampNs` per order, and every aggregated view — `getBookLevels`,
 * the SDK's materialized book, the indexer's own rows — sums both fields away.
 * So a book that reads "990 shares a side, two-sided, 2.7-point spread" off any
 * of them can be, and on this venue is, ONE participant quoting against itself on
 * a twenty-second timer.
 *
 * WHAT WAS MEASURED, 2026-09-02, all 10 live markets on the target venue, twice
 * six minutes apart with identical results:
 *
 *   owners per market      1        (100% of both sides, every market)
 *   orders per market      6        (3 per side: 200 / 330 / 460 shares)
 *   order TTL              11-28s
 *   shares past expiry     0
 *
 * WHY THE "FIRM DEPTH" BUCKET READS 0% HERE, AND CANNOT READ ANYTHING ELSE. The
 * asymmetry that makes a firmness claim possible is real: `placeBinaryOrderFor`
 * delegates placement, while every cancel variant takes ids only and reverts
 * `InvalidOrderOwner()` for anyone but the owner. But four separate things, each
 * verified on this venue, cap the claim at zero:
 *
 *   1. Every owner is a BEACON PROXY. All 291 bytes of it do one thing:
 *      staticcall `implementation()` on the beacon at 0x8815c3f8… and
 *      delegatecall the answer. The owner's own bytecode therefore says nothing
 *      about what the owner can do — scanning it for a cancel selector finds
 *      none, and concluding "no cancel path" from that would be flatly wrong.
 *   2. The beacon's current implementation (0x8635C413…, 26,589 bytes) encodes
 *      `cancelOrder(uint128)` at three sites, none of them in its own dispatch
 *      table — i.e. it CALLS cancelOrder, outbound. The owner cancels.
 *   3. The beacon is upgradeable by 0xd58596620Ee…. Even an implementation with
 *      no cancel path could be swapped for one that has it, so a proxy owner can
 *      never be certified non-pullable: the deciding code is mutable by a third
 *      party.
 *   4. `cancelExpiredOrders` and `sweepExpiredAtLevel` are PERMISSIONLESS, so
 *      firmness expires with the order regardless. Say firm-UNTIL-EXPIRY, never
 *      firm — and here that horizon is under half a minute.
 *
 * The classifier below is kept anyway, and stated precisely, because being able
 * to say WHY the answer is zero is the substance of the claim. What drives
 * severity is the part that varies: quote half-life, and phantom depth.
 *
 * PHANTOM DEPTH is the sharp end. An order past its `expireTimestampNs` that
 * nobody has swept is still returned by `getBookLevels` and still counted by
 * every aggregated view, but the matching loop skips an expired maker rather than
 * filling against it (per the SDK's own documentation of the sweep verbs). So it
 * is displayed liquidity that provably cannot be hit, before any keeper acts.
 * Nothing off-chain can distinguish it from real depth.
 */

import { createHash } from "node:crypto";

import type { Address, PublicClient } from "viem";

import type { RestingOrder } from "./chain";

/**
 * What we could establish about an order owner's ability to withdraw.
 *
 * Note what `opaque` does NOT claim. Absence of a withdraw selector in bytecode
 * is not proof that no path exists — a contract can reach one through a
 * forwarder we failed to recognise. So `opaque` means unverified, and unverified
 * never counts as firm without also clearing the expiry test.
 */
export type OwnerClass = "eoa" | "cancel-capable" | "upgradeable" | "opaque";

export interface OwnerVerdict {
  owner: Address;
  class: OwnerClass;
  /** One clause, for the decision trace. Stated as what was observed. */
  reason: string;
  codeBytes: number;
  /** Set when the owner is a proxy: the target its behaviour actually lives at. */
  delegatesTo: Address | null;
}

/** Selectors whose presence in code means the holder can withdraw or shrink depth. */
const WITHDRAW_SELECTORS: Record<string, string> = {
  dbc91396: "cancelOrder(uint128)",
  "0dce6933": "cancelOrders(uint128[])",
  "33407b60": "reduceOrder(uint128,uint256)",
  "58b91c42": "reduceOrders",
  // Generic forwarders: an owner-controlled arbitrary-call path can reach cancel
  // even with no cancel selector of its own.
  b61d27f6: "execute(address,uint256,bytes)",
  ac9650d8: "multicall(bytes[])",
  "1cff79cd": "execute(address,bytes)",
};

/** Markers that a contract's behaviour lives somewhere else, and is mutable. */
const PROXY_SELECTORS: Record<string, string> = {
  "5c60da1b": "implementation()",
  "3659cfe6": "upgradeTo(address)",
  "4f1ef286": "upgradeToAndCall(address,bytes)",
};

/** True when the runtime code contains a DELEGATECALL, walking past PUSH data. */
function hasDelegatecall(code: Uint8Array): boolean {
  for (let i = 0; i < code.length; ) {
    const op = code[i] as number;
    // Skip PUSH1..PUSH32 immediates, or a 0x60-0x7f data byte reads as an opcode.
    if (op >= 0x60 && op <= 0x7f) {
      i += 1 + (op - 0x5f);
      continue;
    }
    if (op === 0xf4) return true;
    i += 1;
  }
  return false;
}

const hex = (code: string) => code.toLowerCase();

function found(code: string, table: Record<string, string>): string | null {
  const h = hex(code);
  for (const [sel, name] of Object.entries(table)) if (h.includes(sel)) return name;
  return null;
}

/**
 * Address-shaped PUSH immediates in runtime code, most-significant first.
 *
 * A BEACON proxy holds its beacon as a PUSH32 immediate and staticcalls
 * `implementation()` on it. It does NOT answer `implementation()` itself, so
 * asking the proxy directly reverts and the trace ends up saying "a target that
 * can be replaced" when it could name the target. This recovers the candidates
 * so the classification can cite a concrete implementation address.
 */
function addressImmediates(code: Uint8Array): Address[] {
  const out: Address[] = [];
  for (let i = 0; i < code.length; ) {
    const op = code[i] as number;
    if (op >= 0x60 && op <= 0x7f) {
      const len = op - 0x5f;
      const imm = code.subarray(i + 1, i + 1 + len);
      // An address is the low 20 bytes; a PUSH32 carrying one is zero-padded.
      if (len >= 20) {
        const tail = imm.subarray(len - 20);
        const lead = imm.subarray(0, len - 20);
        if (lead.every((b) => b === 0) && tail.some((b) => b !== 0)) {
          out.push(`0x${Buffer.from(tail).toString("hex")}` as Address);
        }
      }
      i += 1 + len;
      continue;
    }
    i += 1;
  }
  return out;
}

const IMPLEMENTATION_ABI = [
  {
    type: "function",
    name: "implementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/**
 * Where a proxy's behaviour actually lives.
 *
 * Tries the proxy itself first (ERC-1967 / UUPS answer `implementation()`), then
 * the addresses baked into its code (the beacon pattern, where the proxy is mute
 * and the beacon answers). Null when neither works, which is honest and does not
 * change the classification: an unresolvable proxy is no more certifiable than a
 * resolvable one.
 *
 * Candidates are capped. A large contract can carry dozens of address immediates
 * and each miss is a full round trip against an RPC that on this box answers in
 * about four seconds or not at all, so an uncapped walk turns one classification
 * into a minute of reverting calls.
 */
async function resolveDelegate(
  client: PublicClient,
  owner: Address,
  code: Uint8Array,
): Promise<Address | null> {
  const candidates = [owner, ...addressImmediates(code)].slice(0, 4);
  for (const address of candidates) {
    try {
      const impl = (await client.readContract({
        address,
        abi: IMPLEMENTATION_ABI,
        functionName: "implementation",
      })) as Address;
      if (impl && !/^0x0{40}$/i.test(impl)) return impl;
    } catch {
      // Not this one; keep looking.
    }
  }
  return null;
}

/**
 * Cached classification, keyed by CODE HASH rather than by address.
 *
 * This is the whole point of the two-level cache. On this venue all ten order
 * owners are byte-identical deployments of the same 291-byte beacon proxy (every
 * one hashes the same), and classifying a proxy costs a `getCode` plus one
 * `implementation()` that reverts on the proxy plus one that succeeds on the
 * beacon. Keyed by address that was thirty round trips per pass to reach ten
 * identical answers. Keyed by code hash it is ten cheap `getCode` calls and ONE
 * resolution, and the second market onward pays nothing at all.
 *
 * Two maps because they answer different questions and expire differently in
 * principle: runtime code at an address is immutable, and a classification is a
 * property of the code rather than of the account holding it.
 */
const codeHashByOwner = new Map<string, string>();
const classificationByCodeHash = new Map<string, Omit<OwnerVerdict, "owner">>();

const hashCode = (code: string): string =>
  createHash("sha1").update(code).digest("hex");

export async function classifyOwner(
  client: PublicClient,
  owner: Address,
): Promise<OwnerVerdict> {
  const key = owner.toLowerCase();

  const known = codeHashByOwner.get(key);
  if (known) {
    const cached = classificationByCodeHash.get(known);
    if (cached) return { owner, ...cached };
  }

  const code = (await client.getCode({ address: owner })) ?? "0x";
  const codeHash = hashCode(code);
  codeHashByOwner.set(key, codeHash);

  const cached = classificationByCodeHash.get(codeHash);
  if (cached) return { owner, ...cached };

  const bytes = Math.max(0, (code.length - 2) / 2);
  let classification: Omit<OwnerVerdict, "owner">;

  if (bytes === 0) {
    classification = {
      class: "eoa",
      reason: "externally owned account; can sign a cancel at any time",
      codeBytes: 0,
      delegatesTo: null,
    };
  } else {
    const raw = Uint8Array.from(Buffer.from(code.slice(2), "hex"));
    const proxyMarker = found(code, PROXY_SELECTORS);
    const isProxy = proxyMarker !== null || hasDelegatecall(raw);
    const withdraw = found(code, WITHDRAW_SELECTORS);

    if (isProxy) {
      // Behaviour is whatever the target currently holds, and the target can be
      // repointed. Resolve it for the trace, but the class does not depend on it:
      // an upgradeable owner is never certifiable as unable to cancel.
      //
      // Safe to memoise against the CODE rather than the account: a beacon proxy
      // hard-codes its beacon as a PUSH immediate, so identical code resolves to
      // the same target by construction. The target's own implementation can
      // change under it, which is exactly why the class is `upgradeable` and does
      // not depend on what we found.
      const delegatesTo = await resolveDelegate(client, owner, raw);
      classification = {
        class: "upgradeable",
        reason: delegatesTo
          ? `proxy delegating to ${delegatesTo}, so the code deciding whether it can cancel is replaceable by whoever controls the target`
          : "proxy: its behaviour lives at a target that can be replaced, so it cannot be certified unable to cancel",
        codeBytes: bytes,
        delegatesTo,
      };
    } else if (withdraw) {
      classification = {
        class: "cancel-capable",
        reason: `contract code contains ${withdraw}`,
        codeBytes: bytes,
        delegatesTo: null,
      };
    } else {
      classification = {
        class: "opaque",
        reason:
          "contract with no cancel, reduce or forwarding selector found; absence in bytecode is not proof one is unreachable",
        codeBytes: bytes,
        delegatesTo: null,
      };
    }
  }

  classificationByCodeHash.set(codeHash, classification);
  return { owner, ...classification };
}

/** Clear both owner caches. Only tests need this. */
export const resetOwnerCache = (): void => {
  codeHashByOwner.clear();
  classificationByCodeHash.clear();
};

// ── the aggregate ──────────────────────────────────────────────────────────────

/** Which bucket an order's shares land in. */
export type DepthBucket = "firm-until-expiry" | "pullable" | "unverified" | "phantom";

export interface OwnerDepth {
  owner: Address;
  class: OwnerClass;
  reason: string;
  /** Shares this owner rests across both sides. */
  shares: number;
  /** That as a fraction of all displayed depth, [0,1]. */
  share: number;
  /** Seconds until this owner's soonest resting order expires. */
  soonestTtlSec: number;
}

export interface DepthMetrics {
  orders: number;
  bidShares: number;
  askShares: number;
  /** Every displayed share, both sides, whole book — not the near-touch subset. */
  totalShares: number;

  /** Distinct owners across both sides. 1 means one participant IS the book. */
  owners: number;
  /** The largest owner's fraction of displayed depth, [0,1]. */
  topOwnerShare: number;
  /**
   * Herfindahl index over owner shares, [0,1]. Reported alongside
   * `topOwnerShare` because they diverge in the case that matters: two makers
   * splitting a book 50/50 gives topOwnerShare 0.5 and concentration 0.5, while
   * one maker plus nine dust orders gives topOwnerShare 0.9 and concentration
   * 0.81 — a meaningfully different book from a 90/10 pair.
   */
  concentration: number;

  /** Seconds until the median resting order expires. Null on an empty book. */
  medianTtlSec: number | null;
  minTtlSec: number | null;
  maxTtlSec: number | null;

  /** Shares in each bucket. `phantom` is excluded from the other three. */
  firmShares: number;
  pullableShares: number;
  unverifiedShares: number;
  /** Past `expireTimestampNs`, still displayed, skipped by the matcher. */
  phantomShares: number;

  byOwner: OwnerDepth[];
  /** Wall clock (ms) the classification was taken. */
  readAt: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
};

/**
 * Bucket one order's shares.
 *
 * Order matters. An expired order is `phantom` whatever its owner is — it cannot
 * be filled, so asking whether the owner could withdraw it is moot. Only an
 * `opaque` owner with a live order can be firm, and even then only until that
 * order's own expiry.
 */
export function bucketOf(cls: OwnerClass, ttlSec: number): DepthBucket {
  if (ttlSec <= 0) return "phantom";
  if (cls === "opaque") return "firm-until-expiry";
  if (cls === "eoa" || cls === "cancel-capable" || cls === "upgradeable") return "pullable";
  return "unverified";
}

/**
 * Reduce a per-order resting book to depth-durability metrics.
 *
 * Shares are human units (raw / 10^decimals). TTLs are measured against `nowMs`
 * so a captured fixture replays to the same numbers rather than drifting.
 */
export async function depthMetrics(
  client: PublicClient,
  book: { bids: RestingOrder[]; asks: RestingOrder[] },
  decimals: number,
  nowMs = Date.now(),
): Promise<DepthMetrics> {
  const all = [...book.bids, ...book.asks];
  const one = 10 ** decimals;
  const nowNs = BigInt(Math.floor(nowMs)) * 1_000_000n;
  const sharesOf = (o: RestingOrder) => Number(o.quantityRemaining) / one;
  const ttlOf = (o: RestingOrder) => Number(o.expireTimestampNs - nowNs) / 1e9;

  const verdicts = new Map<string, OwnerVerdict>();
  for (const owner of new Set(all.map((o) => o.owner.toLowerCase() as Address))) {
    verdicts.set(owner, await classifyOwner(client, owner));
  }

  let firmShares = 0;
  let pullableShares = 0;
  let unverifiedShares = 0;
  let phantomShares = 0;
  const perOwner = new Map<string, { shares: number; soonestTtlSec: number }>();

  for (const o of all) {
    const key = o.owner.toLowerCase();
    const cls = verdicts.get(key)?.class ?? "opaque";
    const shares = sharesOf(o);
    const ttl = ttlOf(o);

    switch (bucketOf(cls, ttl)) {
      case "phantom":
        phantomShares += shares;
        break;
      case "firm-until-expiry":
        firmShares += shares;
        break;
      case "pullable":
        pullableShares += shares;
        break;
      default:
        unverifiedShares += shares;
    }

    const acc = perOwner.get(key);
    if (acc) {
      acc.shares += shares;
      acc.soonestTtlSec = Math.min(acc.soonestTtlSec, ttl);
    } else {
      perOwner.set(key, { shares, soonestTtlSec: ttl });
    }
  }

  const bidShares = book.bids.reduce((a, o) => a + sharesOf(o), 0);
  const askShares = book.asks.reduce((a, o) => a + sharesOf(o), 0);
  const totalShares = bidShares + askShares;

  const byOwner: OwnerDepth[] = [...perOwner.entries()]
    .map(([key, v]) => {
      const verdict = verdicts.get(key);
      return {
        owner: (verdict?.owner ?? key) as Address,
        class: verdict?.class ?? "opaque",
        reason: verdict?.reason ?? "owner code could not be read",
        shares: v.shares,
        share: totalShares > 0 ? v.shares / totalShares : 0,
        soonestTtlSec: v.soonestTtlSec,
      };
    })
    .sort((a, b) => b.shares - a.shares);

  const ttls = all.map(ttlOf);
  return {
    orders: all.length,
    bidShares,
    askShares,
    totalShares,
    owners: perOwner.size,
    topOwnerShare: byOwner[0]?.share ?? 0,
    concentration: byOwner.reduce((a, o) => a + o.share ** 2, 0),
    medianTtlSec: median(ttls),
    minTtlSec: ttls.length ? Math.min(...ttls) : null,
    maxTtlSec: ttls.length ? Math.max(...ttls) : null,
    firmShares,
    pullableShares,
    unverifiedShares,
    phantomShares,
    byOwner,
    readAt: nowMs,
  };
}
