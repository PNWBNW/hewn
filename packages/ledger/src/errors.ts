// Every rule the ledger enforces fails with a stable code, so callers (and
// tests) can tell exactly which invariant an input broke.

export type LedgerErrorCode =
  | "BAD_AMOUNT"
  | "BAD_DATE"
  | "BAD_PERIOD"
  | "EMPTY_ENTRY"
  | "BAD_LINE"
  | "UNBALANCED"
  | "UNKNOWN_ACCOUNT"
  | "INACTIVE_ACCOUNT"
  | "NAME_REQUIRED"
  | "PERIOD_CLOSED"
  | "PERIOD_LOCKED"
  | "UNKNOWN_ENTRY"
  | "ALREADY_REVERSED"
  | "DUPLICATE_ACCOUNT"
  | "BAD_PARENT"
  | "SYSTEM_ACCOUNT"
  | "ACCOUNT_IN_USE"
  | "BAD_CLOSE"
  | "BAD_DOC";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export function fail(code: LedgerErrorCode, message: string): never {
  throw new LedgerError(code, message);
}
