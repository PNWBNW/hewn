import type { Bytes32 } from "@pnw/commitments/aleo_types";

// Lifted from pnw_employment_portal_v1 src/coordinator/receipt_reconciler.ts

export type PaystubReceipt = {
  /** Transaction ID that created this receipt */
  tx_id: string;
  /** The payroll_inputs_hash stored in the receipt record */
  payroll_inputs_hash: Bytes32;
  /** The receipt_anchor stored in the receipt record */
  receipt_anchor: Bytes32;
  /** The batch_id stored in the receipt record */
  batch_id: Bytes32;
  /** The row_hash stored in the receipt record */
  row_hash: Bytes32;
  /** Raw record data for audit trail */
  raw_data?: Record<string, unknown>;
};
