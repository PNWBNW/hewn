// ---------------------------------------------------------------------------
// What the pay queue needs from the outside world, as plain interfaces so
// every path runs under test with fakes: the wallet (Shield, through the
// adaptor), the network (the explorer's REST API), and time.
//
// Nothing in this package logs an address, a record or a signature.
// ---------------------------------------------------------------------------

/** The slice of the wallet adaptor the queue uses. Shield signs; the queue never sees a key. */
export type RailWallet = {
  address: string;
  /** Records the connected account owns for one program; `all` includes spent ones. */
  requestRecords(programId: string, all?: boolean): Promise<unknown[]>;
  /**
   * Asks the wallet to prove, sign and broadcast one transition. The wallet
   * estimates the fee when `fee` is left out. Returns the wallet's own id
   * for the request, which `transactionStatus` maps to the on-chain id.
   */
  executeTransaction(opts: {
    program: string;
    function: string;
    inputs: string[];
    fee?: number;
    privateFee: false;
    /** The person's fee choice for this send; the app's Shield wrapper turns it into privateFee. */
    feeMode?: "public" | "private";
  }): Promise<{ transactionId: string }>;
  transactionStatus(id: string): Promise<{ status: string; transactionId?: string; error?: string }>;
};

/** GET against the explorer, path relative to `ENV.ALEO_ENDPOINT`; resolves with parsed JSON. */
export type RailNetwork = {
  fetchJson(path: string): Promise<unknown>;
};

export type Clock = { now(): number };
export type Sleep = (ms: number) => Promise<void>;

export class RailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RailError";
  }
}

/** A non-OK response from the explorer. */
export class RailNetworkError extends RailError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RailNetworkError";
  }
}

export const systemClock: Clock = { now: () => Date.now() };
export const systemSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
