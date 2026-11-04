// Came from the portal (pnw_mvp_v2/portal/src/types/aleo_types.ts, deleted 2026-11-04); owned here now, and the source of truth.

export type Address = string;  // aleo1...
export type Field = string;    // numeric field element
export type U8 = number;
export type U16 = number;
export type U32 = number;
export type U64 = string;      // string to avoid JS precision loss
export type U128 = string;     // string to avoid JS precision loss
export type Bytes32 = string;  // 0x-prefixed 64-char hex string
