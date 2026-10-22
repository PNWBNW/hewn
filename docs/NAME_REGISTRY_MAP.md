# Name registry map

Oct 15, 2026 · planning, no code changed

Where the app and the Leo programs depend on the name registry today, and how to build the
mainnet names so the same code works with either backend:

- **ANS:** `.hewn` as a top-level domain in the Aleo Name Service (the plan, `BUILD_PLAN.md`
  "Mainnet names").
- **Our own registry:** the fallback if the ANS team won't register `hewn` as a TLD (Joshua,
  2026-10-15). Names then work fully inside the app and its programs, but other wallets and
  explorers won't show them.

Nothing here is decided by code yet. Each step in "The plan" is its own PR.

## The idea in one paragraph

Our programs and our app should never talk to a registry directly. On chain, they ask one
program of ours, **`hewn_names`**, "does this address own this name?" Off chain, the app asks
one module, **the name service**. Behind those two seams sits either ANS or our own mappings.
And the name's id (the `field` every agreement, profile and receipt stores) is computed **the
same way in both cases, using ANS's formula**. Then switching backends, even after mainnet
launch, never changes an id already written into a record.

## What depends on the registry today

### On chain (live on testnet, `config/testnet.manifest.json`)

The dependency types:

- **Hard:** calls the registry, or the hash must match its mapping.
- **Soft:** stores or compares the hash as an opaque `field`.
- **None:** no name involved.

| Program | Dependency | Where |
|---|---|---|
| `pnw_name_registry_v2` | **is the registry** | `name_owner`, `name_kind`, `employer_suffix_code`, `worker_primary_name_of`, `employer_primary_name_of`, plus sell-back mappings. Exposes `assert_is_owner` and `assert_employer_owner` for other programs |
| `pnw_name_registrar_v5` | **is the registrar** | `register_worker_free` and `register_employer_free` (what the app uses), the paid versions, and `name_plaintext` (hash → name, the reverse lookup) |
| `employer_agreement_v4` | **hard** | `assert_is_owner(employer_name_hash, caller)` in offer, pause, terminate and resume; the worker's name in accept, pause, terminate and resume. Agreement records and the parties commitment carry both hashes |
| `credential_nft_v3` (and v4, staged) | **hard** | `mint_credential_nft` checks both names' owners |
| `pnw_worker_profiles_v2` | **hard** | create and update check the worker's name owner |
| `employer_profiles_v2` | **hard, plus the industry** | `assert_employer_owner(hash, caller, suffix_code)`; the industry must match the name's suffix code |
| `pnw_router_v4` | **hard (thin)** | `assert_name_owner` forwards to the registry |
| `paystub_receipts`, `payroll_core_v2` | soft | Store and pass both name hashes; no checks |
| `payroll_nfts_v2`, `audit_nft`, `payroll_audit_log`, `employer_license_registry` | none | Keyed by agreement id and anchors |

### In the app (`apps/business`, `packages/`)

What the app needs from names, and where each operation lives today:

| Operation | Today |
|---|---|
| Hash a name | `packages/records/src/registry/name_registry.ts` `computeNameHash`: BLAKE3("PNW::NAME" ‖ TLV(name)), reduced to a field |
| Name → owner (lookup, is it taken, proof it's yours) | `queryNameOwner`. The steps are repeated in `chain/directory.ts` `lookupName`, `chain/business_registry.ts` `checkName`, `chain/work/Profile.tsx` and `chain/offer.ts` `resolveBusinessName` |
| Address → worker or business name | `queryWorkerName` / `queryEmployerName`, and again in `chain/account_kind.ts` `registryRead` |
| Hash → readable name | `queryNamePlaintext` (registrar). Repeated in `RailPanel`, `Profile`, `RegisterBusiness` and `records/agreement_reader` |
| Hash → kind (worker or business) | `queryNameKind` |
| Hash → industry | `chain/directory.ts` `queryEmployerSuffix` (its own fetch) |
| One kind per wallet | `chain/account_kind.ts` `kindConflict` |
| Register a worker name | `chain/work/registry.ts`: `register_worker_free(hash, name as u128)` |
| Register a business name | `chain/business_registry.ts`: `register_employer_free(hash, name, industry)` |
| Name rules and display | `directory.ts` `NAME_FORMAT`, `work/registry.ts` `NAME_PATTERN`, `books/rail.ts` `REGISTERED_NAME`; the `.hewn` suffix comes from `@pnw/brand` |

Saved in the encrypted vault (would need care if ids ever changed):

- `books/rail.ts`: `businessNameHash`, `businessName`, `links[].nameHash`, `partyLinks[].nameHash` and `.name`.
- `books/work.ts`: `profile.nameHash` and `.name`, `agreements[].employerNameHash` and `.employerName`.

On chain and permanent: agreement, profile, paystub and receipt records carry the name hashes.
Payroll history is grouped by them.

## Things the map turned up

1. **One kind per wallet isn't enforced on chain.** `pnw_name_registry_v2` checks for an
   existing *worker* name before adding a worker name, and counts *business* names, but never
   checks across kinds. Only the app stops it (`account_kind.ts`). Our mainnet program must
   enforce it.
2. **The registrar doesn't tie the name to its hash.** `name_hash` and `name_plaintext` come in
   as separate inputs and nothing checks they match, so a client could register one name's
   hash with another name's text. Computing the id in the program, from the name itself, closes
   this. Until then the app checks every name it reads (2026-10-22, the security review:
   `nameMatchesHash`, `@pnw/records`): the text must hash back to the hash it's filed under and be
   a plain name (`a-z`, `0-9`, `_`), or it isn't shown; the account is shown instead.
3. **Names are capped at 16 characters, by two different rules.** `directory.ts` and
   `work/registry.ts` allow 3 to 16; `books/rail.ts` and `RailPanel` accept 1 to 16. The
   16-character cap comes from storing the name in one `u128`; ANS stores names as `[u128; 4]`
   (up to 64 bytes). One rule, in the name service, should replace all four.
4. **Lookups are built in several places.** Mapping URLs are built in three places, name → owner
   four times, hash → name four times, and stripping the `field` suffix about seven times (not
   consistently: `queryNameKind` leaves it off).
5. **ANS has no kind or industry.** ANS knows who owns a name and which name an address shows.
   It doesn't know whether a name is a worker's or a business's, or a business's industry. Those
   stay in a small table in `hewn_names` in both modes.
6. **To check:** `pnw_router_v4` calls into the agreement program, where `self.caller` would be
   the router rather than the person. If so, offers made through the router would always fail.
   The app doesn't use the router today; worth confirming before the router is carried forward.

## The plan: two seams, one id

### 1. One name id, computed ANS's way, in both modes

The id of `john.hewn` is ANS's name hash:

1. `Poseidon2::hash_to_field(Name { name: [u128; 4], parent: hewn_tld_id })`
2. then `BHP256::hash_to_field`
3. then `BHP256::commit_to_field(…, 0scalar)`

`hewn_tld_id` is the same formula applied to `hewn` with parent `0field`.

- **With ANS,** this is the key ANS itself uses, so our programs can check it against ANS's
  mappings.
- **With our own registry,** `hewn_names` computes the same id in its own transition, from the
  name, so the id is always tied to the name (fixes finding 2).
- **Either way,** a record written today means the same name tomorrow. If ANS says yes after
  launch, we can move over without touching a single agreement or receipt.

The app gets one `nameId(name)` function. It must match the program bit for bit; a test vector
from a Leo test pins it.

### 2. On chain: `hewn_names.aleo` is the only thing other programs ask

Every program that checks ownership today (agreement, profiles, credentials, router) calls
`hewn_names::assert_owner(id, address)`, `assert_kind(id, kind)` and so on, never a registry
directly. `hewn_names` holds:

- **In both modes:**
  - `kind_of: field => u8` (worker or business)
  - `industry_of: field => u8`
  - `kind_of_wallet: address => u8` (one kind per wallet, enforced here; fixes finding 1)
  - the free and paid registration transitions, pricing, and reserved names
- **Our own registry only:**
  - `owner_of: field => address`
  - `name_of: field => [u128; 4]`
  - `primary_of: address => field`
- **With ANS:** ownership and the shown name are read from ANS's mappings (`nft_owners`,
  `names`, `primary_names`), and registering mints under `hewn` through ANS's `register`.

**Choosing the mode.** One Leo source, one constant (`BACKEND`) set before deploy. On testnet we
deploy both builds under different names to prove each path. For mainnet we deploy the one the
ANS answer allows. Whether a Leo program can read another program's mappings in its finalize
code is to be confirmed in the Fable session; if it can't, the ANS build checks a record or a
proof instead, and the plan says so before any code.

**Keep proofs small.** Shield's in-browser prover drops proofs that span many programs (why
payroll runs as four transactions). An agreement checking a name already spans two programs
(the agreement and the registry). The ANS build must not make it three: `hewn_names` should
*read* ANS's mappings in its finalize code (a read, not a call into ANS) rather than call an ANS
function. Test on Shield, not just the CLI, before calling a path done.

**Mainnet is a fresh deploy,** so the agreement, profile and credential programs there are new
programs written against `hewn_names` from the start. On testnet, the live versions keep working
on `pnw_name_registry_v2` until their replacements exist (deployed programs are never edited).

### 3. Off chain: one name service in the app

A single module, say `apps/business/src/chain/names/`, owns every name operation in the table
above:

- `nameId`, `ownerOf`, `nameOf`, `primaryNameOf(address, kind)`, `kindOf`, `industryOf`
- `isTaken`, `kindConflict`
- the two register calls
- one name rule, and display

It has two implementations behind one interface, chosen by the network's manifest: today's
registry, and `hewn_names` (in either mode, reading ANS where ANS holds the truth). The rest of
the app imports only the interface. `directory.ts` already has the right shape
(`DirectoryReads`, injectable); it grows into this. The repeated lookups (finding 4) collapse
into it.

Vault data stays as it is. Ids are kept as decimal strings, and the 16-character name rule
lives in the service instead of `books/rail.ts`, so longer names need no vault change.

## Order of work (one PR each)

1. **App: the name service, wrapping today's registry** (Opus). Moves every lookup behind it,
   one name rule, no change in behaviour, tests that it's the only way to the registry (like
   `fiat_boundary.test.ts`). The app is then ready for either backend.
2. **Leo: `hewn_names.aleo`** (Fable 5.1, high effort). Both builds, with negative tests:
   - a name not owned
   - a second kind on one wallet
   - a taken name
   - a reserved name
   - a short name underpaid
   - an id that doesn't match its name
   - a mint not from our registrar (ANS build)

   Plus the test vector for `nameId`.
3. **Testnet deploy** of both builds, then **the agreement, profile and credential programs**
   in new versions that ask `hewn_names` (Fable).
4. **App: the `hewn_names` implementation** of the name service, switched on by the manifest
   (Opus).
5. **Decide on mainnet** with the ANS answer in hand: same code, one constant.
