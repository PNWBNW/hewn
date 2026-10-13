// Types lifted from pnw_employment_portal_v1 src/stores/worker_store.ts (store itself stays app-side)

import type { Address, Field, Bytes32 } from "@pnw/commitments/aleo_types";

export type PayType = "hourly" | "salary";

export type WorkerRecord = {
  worker_addr: Address;
  worker_name_hash: Field;
  agreement_id: Bytes32;
  status: "active" | "paused" | "terminated";
  display_name?: string; // User-chosen label (session only, not from chain)
  last_payroll_epoch?: number;
  /** Compensation type — set during offer creation, stored in encrypted terms */
  pay_type?: PayType;
  /** Pay rate in dollars — per hour (hourly) or per pay period (salary) */
  pay_rate?: number;
};
