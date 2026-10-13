// Types lifted from pnw_employment_portal_v1 src/stores/audit_store.ts (store itself stays app-side)

import type { Address, Bytes32, U32 } from "@pnw/commitments/aleo_types";

export type AuditRequestStatus =
  | "pending_worker"
  | "approved"
  | "declined"
  | "minted";

export type AuditRequest = {
  auth_id: Bytes32;
  employer_addr: Address;
  worker_addr: Address;
  auditor_addr: Address;
  auditor_display_name?: string; // session only, for PDF
  scope: string; // human-readable scope description
  scope_hash: Bytes32;
  authorization_event_hash: Bytes32;
  policy_hash: Bytes32;
  epoch_from: U32;
  epoch_to: U32;
  expires_epoch?: U32;
  status: AuditRequestStatus;
  created_at: number; // unix ms
  tx_id?: string; // NFT mint tx
  nft_id?: Bytes32;
};
