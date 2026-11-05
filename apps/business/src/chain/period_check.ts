// ---------------------------------------------------------------------------
// The chain half of checking a period proof (docs/AUDIT_DESIGN.md §4, the verifier): whether the
// root the file recomputes to is anchored in payroll_audit_log, at which block and when, and
// whether each payment's transaction is on chain. Three kinds of public read from the explorer:
// the mapping entry for the root, the block it names, and each payment's transaction by id.
// Nothing from the file is sent but the root (already public once anchored) and the
// transaction ids (public on chain). The offline half is @pnw/ledger's `checkPeriodProof`.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import type { PeriodProof } from "@pnw/ledger";
import { type MappingRead, explorerMappingRead } from "./balances";
import { AUDIT_LOG_PROGRAM } from "./close_anchor";

const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^at1[02-9ac-hj-np-z]{58}$/;

/** The root as the mapping's key, `[240u8,203u8,…]`, URL-encoded for the explorer's path. */
export function rootKey(root: string): string {
  if (!HEX64.test(root)) throw new Error("A period root is 64 hex characters");
  const bytes = root.match(/../g)!.map((b) => `${parseInt(b, 16)}u8`);
  return encodeURIComponent(`[${bytes.join(",")}]`);
}

/** The block a root was anchored at, or null when it never was. */
export async function anchorHeight(root: string, read: MappingRead = explorerMappingRead()): Promise<number | null> {
  const value = await read(AUDIT_LOG_PROGRAM, "audit_event_height", rootKey(root));
  if (value === null || value === undefined) return null;
  const m = typeof value === "string" ? /^\s*(\d+)u32\s*$/.exec(value) : null;
  if (!m?.[1]) throw new Error("The network sent the anchor in an unexpected shape");
  const height = Number(m[1]);
  return height > 0 ? height : null;
}

export type ChainReads = {
  anchor: (root: string) => Promise<number | null>;
  /** When a block was made, or null when the network has no such block. */
  blockTime: (height: number) => Promise<Date | null>;
  /** Whether a transaction is on chain. */
  txExists: (id: string) => Promise<boolean>;
};

export function explorerReads(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): ChainReads {
  const base = endpoint.replace(/\/+$/, "");
  const get = (path: string) => fetchImpl(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  return {
    anchor: (root) => anchorHeight(root, explorerMappingRead(endpoint, fetchImpl)),
    blockTime: async (height) => {
      const res = await get(`/block/${height}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`The network answered ${res.status}`);
      const seconds = ((await res.json()) as { header?: { metadata?: { timestamp?: unknown } } })?.header?.metadata?.timestamp;
      return typeof seconds === "number" ? new Date(seconds * 1000) : null;
    },
    txExists: async (id) => {
      const res = await get(`/transaction/${id}`);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`The network answered ${res.status}`);
      return true;
    },
  };
}

export type ChainCheck = { id: "anchored" | "after" | "payments"; ok: boolean; label: string; detail?: string; height?: number; at?: string };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The chain checks of a proof whose offline checks passed, with `root` the root it recomputed to. */
export async function chainChecks(proof: Pick<PeriodProof, "end" | "settlements">, root: string, reads: ChainReads = explorerReads()): Promise<ChainCheck[]> {
  const out: ChainCheck[] = [];
  const height = await reads.anchor(root);
  if (height === null) {
    out.push({ id: "anchored", ok: false, label: "The root is anchored on Aleo", detail: "No anchor for this root: it was never put on chain, or the range was closed again with a different root" });
    return out;
  }
  out.push({ id: "anchored", ok: true, label: "The root is anchored on Aleo", detail: `In block ${height.toLocaleString("en-US")}`, height });
  const time = await reads.blockTime(height);
  if (time) {
    const after = dayOf(time) > proof.end;
    out.push({
      id: "after",
      ok: after,
      label: "It was anchored after the range ended",
      detail: after ? `On ${dayOf(time)}, after ${proof.end}` : `On ${dayOf(time)}, before the range ended on ${proof.end}`,
      at: time.toISOString(),
    });
  } else {
    out.push({ id: "after", ok: false, label: "It was anchored after the range ended", detail: "The network didn't return that block's time" });
  }
  const ids = proof.settlements.map((s) => s.txId);
  if (ids.length > 0) {
    const odd = ids.filter((id) => !TX.test(id));
    const missing: string[] = [];
    for (const id of ids.filter((x) => TX.test(x))) if (!(await reads.txExists(id))) missing.push(id);
    const ok = missing.length === 0 && odd.length === 0;
    out.push({
      id: "payments",
      ok,
      label: `Every payment's transaction is on chain (${ids.length})`,
      ...(ok
        ? {}
        : { detail: [missing.length ? `${missing.length} not found (first: ${missing[0]})` : "", odd.length ? `${odd.length} not a transaction id` : ""].filter(Boolean).join("; ") }),
    });
  }
  return out;
}
