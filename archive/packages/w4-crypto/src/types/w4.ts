// Types lifted from pnw_employment_portal_v1 src/stores/w4_store.ts (store itself stays app-side)

import type { FilingStatus } from "@pnw/tax-engine/tax-engine";

export type W4Data = {
  /** Step 1: Filing status */
  filingStatus: FilingStatus;

  /** Step 2: Multiple jobs or spouse works (checkbox) */
  multipleJobsOrSpouseWorks: boolean;

  /** Step 3: Number of qualifying children (for $2,000 credit each) */
  qualifyingChildren: number;

  /** Step 3: Number of other dependents (for $500 credit each) */
  otherDependents: number;

  /** Step 3: Total dependent credit (computed: children × $2,000 + other × $500) */
  totalDependentCredit: number;

  /** Step 4a: Other income (not from jobs — investments, etc.) */
  otherIncome: number;

  /** Step 4b: Deductions beyond the standard deduction (itemized excess) */
  extraDeductions: number;

  /** Step 4c: Extra withholding per pay period (flat dollar amount) */
  extraWithholding: number;

  /** When the W-4 was last updated (UTC ms) */
  updatedAt: number;

  /** Whether the W-4 has been completed at least once */
  completed: boolean;
};
