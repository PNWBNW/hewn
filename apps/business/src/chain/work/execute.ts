// ---------------------------------------------------------------------------
// One transition, signed in Shield and waited for. Every write the person's
// side makes (register a name, create a profile, accept an offer) goes
// through here: the wallet package's executor with `privateFee: false` (the
// flag Shield needs to build a proof at all), the fee left to Shield's own
// estimate as the pay queue does, then the wallet's own status until it
// says accepted or rejected. Nothing here logs an input, an id or an error.
// ---------------------------------------------------------------------------

import { type WalletExecuteFn, executeAleoTransaction } from "@pnw/wallet/wallet-executor";

/** The slice of the adaptor this needs; a fake with the two methods does for tests. */
export type WorkWallet = {
  executeTransaction(opts: { program: string; function: string; inputs: string[]; fee?: number; privateFee: false }): Promise<{ transactionId: string } | null | undefined>;
  transactionStatus(id: string): Promise<{ status: string; transactionId?: string; error?: string }>;
};

export type Call = { program: string; function: string; inputs: string[] };

export type ExecuteOptions = {
  /** How long to wait for Shield to say accepted. Default 5 minutes. */
  capMs?: number;
  /** Between two status checks. Default 4 seconds. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type Executed = {
  /** The on-chain id when Shield reported one, else the wallet's own id for the request. */
  transactionId: string;
};

export class ExecuteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecuteError";
  }
}

const ACCEPTED = new Set(["accepted", "finalized", "confirmed", "completed"]);
const REJECTED = new Set(["rejected", "failed"]);
const isOnChainId = (id: string | undefined): id is string => typeof id === "string" && id.startsWith("at1");

/** Asks Shield to prove, sign and broadcast one transition, then waits until it is accepted. */
export async function executeAndWait(wallet: WorkWallet, call: Call, options: ExecuteOptions = {}): Promise<Executed> {
  const capMs = options.capMs ?? 5 * 60_000;
  const pollMs = options.pollMs ?? 4_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  const execute: WalletExecuteFn = async (p) => {
    const r = await wallet.executeTransaction({ program: p.program, function: p.function, inputs: p.inputs, privateFee: false });
    if (!r?.transactionId) throw new ExecuteError("Shield didn't take the request");
    return r.transactionId;
  };
  // The fee argument is unused: the adaptor call above leaves it to Shield's estimate.
  const walletId = await executeAleoTransaction(execute, call.program, call.function, call.inputs, 0);

  let onChainId: string | undefined = isOnChainId(walletId) ? walletId : undefined;
  const started = now();
  while (now() - started < capMs) {
    await sleep(pollMs);
    let status: Awaited<ReturnType<WorkWallet["transactionStatus"]>>;
    try {
      status = await wallet.transactionStatus(walletId);
    } catch {
      continue; // the wallet may not know the id yet; keep asking
    }
    if (isOnChainId(status.transactionId)) onChainId = status.transactionId;
    const s = (status.status ?? "").toLowerCase();
    if (REJECTED.has(s)) throw new ExecuteError(status.error || "Shield reported the request failed");
    if (ACCEPTED.has(s)) return { transactionId: onChainId ?? walletId };
  }
  throw new ExecuteError("No answer from Shield in time; check it before trying again");
}
