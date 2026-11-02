// ---------------------------------------------------------------------------
// Anchoring a close (docs/CLOSE_PERIOD.md, docs/AUDIT_DESIGN.md §2): the
// period root goes on chain through the deployed payroll_audit_log, which
// records the block it first appeared at and refuses the same hash twice.
// Only the 32-byte root is public: no amount, name or account. The fee is
// public on purpose: a private fee is what fails in Shield on testnet
// (packages/wallet/README.md, Fees), and Shield covers it there anyway.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { bytesToAleoU8Array } from "./offer";
import type { Call } from "./work/execute";

export const AUDIT_LOG_PROGRAM: string = PROGRAMS.layer1.payroll_audit_log;
export const ANCHOR_EVENT = { program: AUDIT_LOG_PROGRAM, function: "anchor_event" } as const;

/** The call that anchors a period root (64 hex) as `[u8; 32]`. */
export function anchorCall(root: string): Call {
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error("A period root is 64 hex characters");
  return { ...ANCHOR_EVENT, inputs: [bytesToAleoU8Array(root)], feeMode: "public" };
}
