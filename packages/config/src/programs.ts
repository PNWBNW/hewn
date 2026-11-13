// ============================================================
// Program ID Registry
// Mirrors pnw_mvp_v2/config/testnet.manifest.json (program ids; editions since 2026-11-11)
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
  // A worker's credentials (docs/HEWN_ART.md; deployed 2026-10-25 from pnw_mvp_v2, block 20806575):
  // two private copies per credential, a public commitment with its status and its issue block.
  credentials: {
    hewn_credentials: "hewn_credentials_v1.aleo",
  },
  external: {
    usdcx: "test_usdcx_stablecoin.aleo", // testnet only
    usdcx_freezelist: "test_usdcx_freezelist.aleo", // testnet only
    // What the stablecoin imports, read only to pin their editions (EDITIONS below).
    usdcx_multisig_core: "test_usdcx_multisig_core.aleo", // testnet only: approves the stablecoin's upgrades
    merkle_tree: "merkle_tree.aleo",
  },
  // Superseded programs still read for what was made with them (never written to).
  legacy: {
    // v1 registry (@noupgrade): only read for business names registered before v2.
    pnw_name_registry_v1: "pnw_name_registry.aleo",
  },
} as const;

/**
 * The edition of each of our upgradable programs this version of the app was made for.
 *
 * A program whose constructor is `@admin` can be upgraded in place by whoever holds the admin
 * key, and an upgrade may change the logic inside a function people already use, under the same
 * name, inputs and outputs. A wallet proves against the newest edition without saying so. So
 * before the app asks for any signature it reads each of these from the network and refuses if
 * one is at an edition not listed here (apps/business/src/chain/editions.ts; docs/THREAT_MODEL.md
 * T21). A program whose constructor is `@noupgrade` can never change, so it isn't listed.
 *
 * Mirrors `edition` in pnw_mvp_v2/config/testnet.manifest.json, which is checked against the
 * chain every day there (programs.test.ts keeps the two in step). A planned upgrade lists both
 * editions here first, ships, and drops the old one afterwards.
 */
export const OUR_EDITIONS: Readonly<Record<string, readonly number[]>> = {
  [PROGRAMS.layer1.pnw_name_registry]: [1],
  [PROGRAMS.layer1.pnw_name_registrar]: [1],
  [PROGRAMS.layer1.worker_profiles]: [0],
  [PROGRAMS.layer1.employer_profiles]: [0],
  [PROGRAMS.layer1.employer_agreement]: [2],
  [PROGRAMS.layer1.payroll_core]: [1],
  [PROGRAMS.layer1.paystub_receipts]: [0],
  [PROGRAMS.layer1.pnw_router]: [0],
  [PROGRAMS.layer2.credential_nft]: [0],
};

/**
 * The stablecoin every payment runs, and the programs it imports. Its issuer can upgrade it: its
 * constructor takes any edition the multisig core has approved, and the core can be upgraded by
 * its own upgrader. So these are pinned like ours, at the editions read from the chain on
 * 2026-11-12. An upgrade by the issuer stops payments in this app until a release lists the new
 * edition, after someone has read what changed. `merkle_tree.aleo` has no constructor (deployed
 * before upgrades existed); it is pinned anyway, at no cost.
 */
export const EXTERNAL_EDITIONS: Readonly<Record<string, readonly number[]>> = {
  [PROGRAMS.external.usdcx]: [2],
  [PROGRAMS.external.usdcx_freezelist]: [1],
  [PROGRAMS.external.usdcx_multisig_core]: [0],
  [PROGRAMS.external.merkle_tree]: [1],
};

/** Everything the app checks before any signature: its own upgradable programs and the stablecoin's. */
export const EDITIONS: Readonly<Record<string, readonly number[]>> = { ...OUR_EDITIONS, ...EXTERNAL_EDITIONS };

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
