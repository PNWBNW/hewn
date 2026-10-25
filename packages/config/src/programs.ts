// ============================================================
// Program ID Registry
// Mirrors pnw_mvp_v2/config/testnet.manifest.json
// Synced from commit: b1f9dfb (pnw_mvp_v2 main)
// Synced on: 2026-03-26
// ============================================================

export const PROGRAMS = {
  network: "testnet",
  layer1: {
    payroll_core: "payroll_core_v2.aleo",
    paystub_receipts: "paystub_receipts.aleo",
    payroll_audit_log: "payroll_audit_log.aleo",
    employer_agreement: "employer_agreement_v4.aleo",
    // v5 (staged 2026-10-23, pnw_mvp_v2 docs/migrations/2026-10-23-agreement-v5.md): two parties, the
    // P-256 public halves in the records, no registry call. Read and offered to once deployed:
    // apps/business/src/chain/agreement_programs.ts says which programs are live for the app.
    employer_agreement_v5: "employer_agreement_v5.aleo",
    employer_license_registry: "employer_license_registry.aleo",
    employer_profiles: "employer_profiles_v2.aleo",
    worker_profiles: "pnw_worker_profiles_v2.aleo",
    pnw_name_registry: "pnw_name_registry_v2.aleo",
    pnw_name_registrar: "pnw_name_registrar_v5.aleo",
    pnw_router: "pnw_router_v4.aleo",
  },
  layer2: {
    payroll_nfts: "payroll_nfts_v2.aleo",
    // credential_nft_v3 adds hard on-chain authorization: the mint
    // transition calls employer_agreement_v4::assert_employer_authorized
    // (parties commitment + ACTIVE status) + two pnw_name_registry_v2
    // ownership checks, so only the employer of an active agreement
    // for the target worker can mint a credential. v2 had no auth
    // check (anyone could mint a fake). v1 was @noupgrade single-record.
    credential_nft: "credential_nft_v3.aleo",
    audit_nft: "audit_nft.aleo",
  },
  // Private letters as records (docs/LETTERS.md in this repo): the chain is the mailbox.
  letters: {
    // v2 (deployed 2026-10-18) sends: send, send_page, and send_many (one announcement to up to eight).
    hewn_letters: "hewn_letters_v2.aleo",
    // v1 (2026-10-16) is only read: letters sent before v2 stay in people's wallets.
    hewn_letters_v1: "hewn_letters_v1.aleo",
  },
  // The public job board (docs/JOB_BOARD.md): postings in public mappings, gated by the business's .hewn name.
  jobs: {
    hewn_jobs: "hewn_jobs_v1.aleo",
  },
  // The cards every account gets (docs/HEWN_ART.md; deployed 2026-10-25): one public entry per
  // name, the block the card was issued at (where time on Hewn counts from) and whether it is shown.
  cards: {
    hewn_cards: "hewn_cards_v1.aleo",
  },
  external: {
    usdcx: "test_usdcx_stablecoin.aleo", // testnet only
    usdcx_freezelist: "test_usdcx_freezelist.aleo", // testnet only
  },
} as const;

/** Current version tags — must match deployed program expectations */
export const VERSIONS = {
  // v2: run_kind + run_memo added to the payroll_inputs_hash / row_hash /
  // batch_id preimages (double-pay protection). Hashes are computed
  // portal-side and passed to programs as opaque bytes, so no Leo
  // redeployment is required.
  schema_v: 2,
  calc_v: 1,
  policy_v: 1,
} as const;
