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

/** The network's own program: fees and public credits. It never changes version, so it isn't in PROGRAMS. */
export const NATIVE_PROGRAM = "credits.aleo";

/**
 * The address of every program named above, and of the network's own.
 *
 * A program has an address written like an account's, worked out from its id alone (the same on
 * every network), and nobody holds a key for it: a private payment sent there could never be
 * spent. So none of these is ever a payee, and none is a person or a business to find: the pay
 * queue (packages/rail) and the directory lookups (apps/business/src/chain/directory.ts) refuse
 * them, as they refuse the zero address.
 *
 * programs.test.ts derives each from its id with the SDK (`Address.fromProgramId`) and fails when
 * a program is added to PROGRAMS without its address here.
 */
export const PROGRAM_ADDRESSES: Readonly<Record<string, string>> = {
  [PROGRAMS.layer1.payroll_core]: "aleo1wk9yg6le0ny5m8hqcq0v7mvxkfwysdl4r0hgun02935ywc3wgugskclejm",
  [PROGRAMS.layer1.paystub_receipts]: "aleo1xzz9zy5xancl7xgkx2p3fm8njslzx0ynqs3dmszmaqxpsaw0zy9ssfeg75",
  [PROGRAMS.layer1.payroll_audit_log]: "aleo18emkaa0x0emaax6whpf483ne99zxyllz736am4vru5jc5w8g25xqz0s3vk",
  [PROGRAMS.layer1.employer_agreement]: "aleo19mx7l3qhelduettn7zyl9amccc7pkuacplql6enl9nmfcts66gpqa3d9wt",
  [PROGRAMS.layer1.employer_agreement_v5]: "aleo12nvkretqrdpzhnt63z7gxdejcegtx20t8vuftqsgkauudv6yxggsczq2ar",
  [PROGRAMS.layer1.employer_license_registry]: "aleo1jh3ze55ghxrnupapyz4vwnnsyp2kazfc4g0e8ddrl3nmu2l8usrq2tsa3j",
  [PROGRAMS.layer1.employer_profiles]: "aleo1cwtpjdu4hlw5udferamj3ltuh3xnxtsnl2846mcshq6p6k9tzu8suk90a6",
  [PROGRAMS.layer1.worker_profiles]: "aleo18ac7xandpu45hej69sgeq9h5glvemc3nz5095vtxqv3ac5fr8uyq63te4n",
  [PROGRAMS.layer1.pnw_name_registry]: "aleo13hv42s0zmgqsqgmfl9ph36363mj9vudm7pcfmreyw79dlf6zts8qkpkrru",
  [PROGRAMS.layer1.pnw_name_registrar]: "aleo182yu0apetjymwrw52tnx3wx9rc3kw3t6asvwesd3maa9ruz4fqrqw3hven",
  [PROGRAMS.layer1.pnw_router]: "aleo1ajzuj823vlfqah7q3r7duqf8znq43zfr0w6y4vwwqmmyurq3gvqqmeh9jh",
  [PROGRAMS.layer2.payroll_nfts]: "aleo17ftxpuel0degsmdjg9cdy2z2envy4cjzep4uu9tpwt4y2r44yurql3dwv7",
  [PROGRAMS.layer2.credential_nft]: "aleo19laxw328g6xd8hh78czs7lt4ag2rdf8zfwpjhdjmkdxqpm4tmgpqgz8lg0",
  [PROGRAMS.layer2.audit_nft]: "aleo1h7ug2u7d98rtl5hy2v5925ff6uv8fr07pmyzx90ghfezzkq0y5xq2dz9aj",
  [PROGRAMS.letters.hewn_letters]: "aleo1t4tqmjffm6cxturwhjajlyuzgf3x68as26jwn0p0ztmx64uvvyxq73n6lr",
  [PROGRAMS.letters.hewn_letters_v1]: "aleo1vqr7k38m8dm6vth8d7nvun00mtapqhkfxhjvmk9j03jx29knkqxsd0t40j",
  [PROGRAMS.jobs.hewn_jobs]: "aleo1qr4mrhx7g3m7pcu9w99v57kuz75rp2fly7m5lfatt0vaz25xscxsk5rxqj",
  [PROGRAMS.cards.hewn_cards]: "aleo15z28lp6gwycmkw4aa9pgwrf708eljcszuz0z9rnyzr349e9c5vyqvagetn",
  [PROGRAMS.credentials.hewn_credentials]: "aleo1pmkjmfnkp08lve4es02mr5eugkfzpv6pdjmqw3wu49ak0v5fyq9qmtx9dv",
  [PROGRAMS.external.usdcx]: "aleo1k9p765k8wnx36jj3n588jmc4j947t20p630dekv99hfr7684xsqsefxfwm",
  [PROGRAMS.external.usdcx_freezelist]: "aleo1jsp2k72uez97cg8q4j0uhedt9flea099he5gjevnc5x958dgzcrszq9aum",
  [PROGRAMS.external.usdcx_multisig_core]: "aleo1gkx923022fwagm8yynw8guryaaztj94h5sa9kujda9e6e2nfkgys8mksqd",
  [PROGRAMS.external.merkle_tree]: "aleo1yx2s0lpts2gvzpgkmqpk5p3jrmqclu7cyyz7mmeydhla6peu8czqqc7d0v",
  [PROGRAMS.legacy.pnw_name_registry_v1]: "aleo1u2v4uzn9xg0xrdm23s6cd84xe6a24a6nqmftkje385dwyvj7yu8qxjg42s",
  [NATIVE_PROGRAM]: "aleo1lqmly7ez2k48ajf5hs92ulphaqr05qm4n8qwzj8v0yprmasgpqgsez59gg",
};

const PROGRAM_ADDRESS_SET: ReadonlySet<string> = new Set(Object.values(PROGRAM_ADDRESSES));

/** True for the address of a program this app knows: never an account to pay or to look up. */
export const isProgramAddress = (address: string): boolean => PROGRAM_ADDRESS_SET.has(address);

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
