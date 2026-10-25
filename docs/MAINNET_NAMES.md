# Mainnet names: `.hewn` under the Aleo Name Service

**Status:** design (Joshua, 2026-10-15), moved here from `BUILD_PLAN.md` on 2026-10-25. Its
checklist is the plan for mainnet names; tick items here. The decisions are in the build plan's
Decisions.

Mainnet names move onto the **Aleo Name Service** (ANS, [ARC-137](https://github.com/ProvableHQ/ARCs/discussions/45),
built on ARC-721) instead of our own registry. ANS is one shared registry program
(`aleo_name_service_registry.aleo`) with `primary_names: address => field` (reverse resolution)
and `names: field => NameStruct` (the readable name). Wallets and explorers that support ANS read
it through the open-source indexer ([aleo-name-service-api](https://github.com/S-T-Soft/aleo-name-service-api)),
which follows the registry's `tlds` mapping, so once `hewn` is a TLD, `john.hewn` shows wherever
those apps show an address, and people can send to it, with no change on their side. Our current
`pnw_name_registry` stays on testnet only.

How it works
1. **`hewn` becomes a TLD.** `register_tld(registrar, "hewn")` in the ANS registry is admin-only, so
   the ANS team (S-T-Soft, authors of ARC-137) runs it with our registrar program as the TLD's
   owner. After that only our registrar can mint under `hewn` (the registry checks
   `caller == nft_owners[parent]`). Ask them before mainnet; it is a conversation, not code.
2. **Our registrar program** (new Leo, Fable 5.1 at high effort, negative tests) mints under `hewn`:
   - **Free tier:** a random public name (ANS `register`), assigned at setup, no fee beyond the
     network's. Nothing to choose, nothing to squat. It is public like a paid name (Joshua,
     2026-10-15): it resolves to the address, can be the wallet's primary name, and shows in every
     ANS-aware wallet and explorer. People find each other by that name or by Aleo address. The
     only difference from the paid tier is that the name isn't chosen.
   - **Paid tier:** a chosen public name, a one-time purchase priced by length (proposed: 1–3
     characters $100+, 4 characters about $20, 5+ characters 1 USDCx; final numbers Joshua's
     call), paid in USDCx. Reverse resolution (`set_primary_name`) and the name on every
     ANS-aware wallet and explorer. Reserved names (brand names, offensive terms, `admin`,
     `support`, `hewn`, …) refused; the DAO can release them.
   - **No renewal and no expiry** (Joshua, 2026-10-15): ANS names are permanent NFTs, like `.ans`
     names, and the registry has no expiry. Squatting is limited by price alone. (A usage credit
     toward renewal was considered and dropped with it.)
   - **One kind per wallet:** refuses a business name for a wallet holding a worker name, and the
     reverse (the app checks this today, `chain/account_kind.ts`). Testnet's
     `pnw_name_registrar_v5` doesn't, and its tests record that (PNWBNW/pnw_mvp_v2#225); Joshua
     confirmed the rule on 2026-10-25. A worker's account can still be a business's customer.
3. **Our programs** (agreements, receipts, payroll anchoring, the double-pay guard) key on ANS's
   name hash (`Poseidon2` → `BHP256`, see the ARC) instead of `computeNameHash`. Mainnet is a
   fresh deploy, so nothing migrates.
4. **The app** resolves names by reading the registry's mappings from the explorer, as it reads our
   registry now, or by running the open-source indexer; it never depends on ANS's hosted API.

**If ANS says no** (Joshua, 2026-10-15): the same plan runs on our own registry. Everything is
built so either backend works with the same programs and app code
([`NAME_REGISTRY_MAP.md`](NAME_REGISTRY_MAP.md)):

- Other programs only ask our `hewn_names` program, never a registry directly.
- The app only asks one name service.
- A name's id is ANS's name hash in both cases, so records never change if we switch later.

What's lost without ANS: other wallets and explorers won't show `.hewn` names.

Exit criteria
- [ ] The app reaches names only through one name service (today's registry behind it), with a
  test that nothing else reads the registry
- [ ] `hewn_names` built in both modes (ANS and our own registry) from one source, both deployed
  on testnet, with negative tests; its name id matches the app's `nameId` on a shared test vector
- [ ] `hewn` registered as an ANS TLD on testnet, with our registrar as its owner (or, if ANS says
  no, the own-registry build chosen for mainnet)
- [ ] Registrar deployed on testnet with both tiers, length pricing, reserved names and one kind
  per wallet; negative tests: a short name underpaid, a reserved name, a second kind on one
  wallet, a name already taken, a mint not from the registrar
- [ ] A `.hewn` name set as primary shows on AleoScan (or another ANS-aware explorer) with no
  change on their side
- [ ] The app registers both tiers through Shield, finds people by address or name, and shows a
  linked party's `name.hewn` read from the ANS registry
- [ ] Mainnet deploy, with `config/mainnet.manifest.json` as its source of truth
- [ ] Maybe: turn off the testnet page counts (Vercel Web Analytics, hewn #100) before mainnet, or keep
  them; decide at launch (Joshua, 2026-10-19)
