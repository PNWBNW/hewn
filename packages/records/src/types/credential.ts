// Types lifted from pnw_employment_portal_v1 src/stores/credential_store.ts (store itself stays app-side)

import type { Address, Bytes32, Field } from "@pnw/commitments/aleo_types";

export type CredentialType =
  | "employment_verified"
  | "skills"
  | "clearance"
  | "custom";

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  employment_verified: "Employment Verified",
  skills: "Skills",
  clearance: "Clearance",
  custom: "Custom",
};

export type CredentialStatus = "active" | "revoked" | "pending";

export type CredentialRecord = {
  // Identity
  credential_id: Bytes32;
  credential_type: CredentialType;
  credential_type_label: string;

  // Parties (privacy-preserving hashes — never raw names)
  worker_addr: Address;
  employer_addr: Address;
  subject_hash: Field;
  issuer_hash: Field;

  // Content
  scope: string;
  scope_hash: Bytes32;
  doc_hash: Bytes32;

  // Timing
  issued_epoch: number;
  expires_epoch?: number; // undefined = no expiry

  // On-chain state
  status: CredentialStatus;
  tx_id?: string;       // mint tx
  revoke_tx_id?: string; // revoke tx (if revoked)

  // Wallet signature proof (if signed via wallet adapter)
  signature_proof?: string;
};
