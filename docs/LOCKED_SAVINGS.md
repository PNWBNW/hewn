# Locked savings: a split-key escrow account

**Status:** an idea, for outside review (2026-10-24). Nothing is built. We'd like Aleo developers
to tell us whether it's sound, and whether it steps on anything the ecosystem is building, before
we write a line of it.

## What we want

Hewn runs private payroll on Aleo (USDCx, signed in the Shield wallet). We want to offer workers
something like a retirement plan:

- **The business decides what it offers**, as part of the employment agreement: lock terms of 1,
  3, 5 or 10 years (any of them, one, or none), and a match, e.g. $1 for $1 up to 3% of each
  paycheck's gross. The worker may save more than the match covers.
- **The worker opts in** by choosing a percentage and a term. Every paycheck adds to the account,
  and everything in one enrollment unlocks on one date (the enrollment date plus the term).
- **The worker can opt out any time.** Deductions stop, and what's saved stays locked until its
  date. Opting back in waits for the business's next open-enrollment window.
- **Early exit:** the worker can leave early with their own money; the match goes back to the
  business.
- **Beneficiary:** if the worker never claims (a lost wallet, a death), someone they named can,
  a year after the unlock date.
- **No interest in v1.**

Hewn's privacy floor applies: nothing tied to a person (wages, savings, match, dates) is ever
public, and no server holds private data.

## Why not a vault program

The obvious design is a program that holds the money and releases it on a date. On Aleo that
program can't hold it privately:

- **Only a record's owner can spend it, and the owner must be the signer.** The check is in the
  request (`snarkvm-console-program` 4.12.0, `src/request/verify.rs:113`: "Input record does not
  belong to the signer") and in the circuit (`snarkvm-circuit-program`, `src/request/verify.rs:307`).
  A program never signs, so it can't spend records. It can only hold a public balance.
- **USDCx's `Token` record is just `owner` and `amount`**, with no lock field (the program on
  testnet).
- So a vault means deposits through `transfer_private_to_public` and payouts through
  `transfer_public_to_private`. Every deposit and payout amount is public, and so is the vault's
  total. We can blur it (round deposits, one deposit per pay run), but it is still one public pool
  holding many people's money.

## The idea: one Aleo account per enrollment, its key split in two

Each enrollment gets its own ordinary Aleo account, E. Its private key never exists in one place:
half lives in the worker's app and half in the business's app. The business's half is time-locked
to the unlock date with drand.

### The key

An Aleo private key is two scalars, `(sk_sig, r_sig)` (`snarkvm-console-account` 4.12.0):

```
pk_sig  = G * sk_sig
pr_sig  = G * r_sig
sk_prf  = HashToScalar(pk_sig.x, pr_sig.x)      compute_key/try_from.rs
address = pk_sig + pr_sig + G * sk_prf          compute_key/to_address.rs
view_key = sk_sig + r_sig + sk_prf               view_key/try_from.rs
sk_tag  = Hash(graph_key_domain, view_key, 0)    graph_key/try_from.rs
```

The worker's app W picks `(a_w, b_w)` and the business's app B picks `(a_b, b_b)`, with
`sk_sig = a_w + a_b` and `r_sig = b_w + b_b`. Neither ever holds the sum.

- **The address comes from public pieces:** `pk_sig = G*a_w + G*a_b`, `pr_sig = G*b_w + G*b_b`.
- **Setup is commit, then reveal, with a Schnorr proof of knowledge for each piece,** so neither
  side can choose its public piece after seeing the other's and end up owning the whole key.
- **Both sides learn the view key:** each reveals `a_i + b_i`. That lets both see E's records,
  which they'd know anyway (the business sends them), and it can't spend.

### Deposits

The business's pay run sends the deduction and the match to E as ordinary private USDCx transfers,
signed in Shield like every other payment. There's no new program, nothing public, and no pool:
each enrollment's money sits in its own account.

### Spending: two-party signing of a normal request

`Request::sign` (`snarkvm-console-program`, `src/request/sign.rs`) uses the key in these places:

| Value | Single signer | Split |
|---|---|---|
| nonce `r` | `HashToScalar(sk_sig, nonce)` (line 62) | `r = r_w + r_b`, each random |
| `g_r = r*G`, `tvk = (r*signer).x`, `h_r = r*H` per record input | from `r` | sums of each side's pieces |
| `gamma = sk_sig*H` per record input | from `sk_sig` | `a_w*H + a_b*H` |
| `response = r - c*sk_sig` | from `sk_sig` | `(r_w - c*a_w) + (r_b - c*a_b)` |
| `sk_tag` | from the view key | both know the view key |

The protocol in outline:
1. **Commit:** each side commits to its pieces (`r_i*G`, `r_i*signer`, `r_i*H_j`, `a_i*H_j`).
2. **Reveal and compute:** both reveal, then each computes `tvk`, `tcm`, `scm`, the input ids and
   the challenge `c` exactly as `sign.rs` does.
3. **Combine:** each returns its share of the response, and the two add up to one signature.
4. **Assemble and prove:** the `Request` is put together through its `From<(...)>` impl
   (`src/request/mod.rs:59`), and the proof is made with `Process::execute(authorization)`
   (`snarkvm-synthesizer-process`, `src/execute.rs:22`), which needs no key.

### The time lock

B's pieces `(a_b, b_b)` are encrypted with tlock to the drand quicknet round at the unlock date.
Quicknet is run by the League of Entropy: 3-second rounds, BLS12-381, unchained,
`bls-unchained-g1-rfc9380`. The encrypted copy goes to W inside a sealed letter, over the
conversation's P-256 channel (`TWIN_CURVE_CONVERSATIONS.md`).

- **Before the date:** neither side can spend alone. Both together can, which is the early exit:
  the worker's own money goes to W, the match to B.
- **After the date:** W decrypts B's pieces and spends alone, moving everything to the worker's own
  account.
- **Beneficiary:** W's pieces, plus a copy of the time-locked B pieces, are encrypted to the
  beneficiary and time-locked to a year after the unlock date.
- **If drand stops for good:** the plan terms require the business to co-sign a full release to
  the worker. A second, independent time-lock network locking the same pieces would remove that
  dependence (whichever opens first); we haven't chosen one. If drand and the business are both
  gone, the money is stuck. Every failure we can design for releases toward the worker.

On 2026-10-24 we checked tlock end to end against `api.drand.sh` with `tlock-js` 0.9.0. We locked a
secret to a round 45 seconds out, and decrypting early was refused ("too early to decrypt").
After the round it opened, with the beacon checked against quicknet's public key. A 5-year lock
from that day is round 85,921,012.

## Trade-offs

| | Vault program | Split-key account |
|---|---|---|
| What enforces the lock | Program code on chain | Cryptography: two key halves, one time-locked |
| Privacy | Pool total, deposit and payout amounts public | Ordinary private transfers; nothing on chain ties E to anyone |
| Pooled money | Yes, everyone's in one balance | No, one account per enrollment |
| New code to trust | A Leo program (audit) | Two-party signing over Aleo's curve and the setup protocol (cryptographic review) |
| Outside dependency | None | drand, possibly for 10 years |
| Who signs payouts | The worker, in Shield | Hewn's app, outside Shield (see below) |

Known costs of the split-key account:
- **New cryptography.** As far as we know there is no two-party signing library for Aleo's
  signature scheme. We'd build it and have it reviewed before it holds real money.
- **Signing outside the wallet.** Hewn's rule is that every on-chain write is signed in the user's
  Shield wallet, so they see what they sign. E isn't a Shield account. Deposits still go through
  Shield; payouts from E would be signed in Hewn's app.
- **Fees.** E needs a little ALEO for its own transactions, sent in at setup.
- **USDCx compliance.** The issuer can freeze E like any other address.
- **drand requests.** Fetching a specific future round could hint at an unlock date to whoever
  runs that server. A minor point, but real.

## Proof of concept (planned, not started)

Run on testnet with throwaway accounts, as standalone Rust against the snarkVM crates (outside
the app):

1. **Key setup:** two parties, W and B, as separate objects that never share secrets; commit,
   reveal, proofs of knowledge. Outputs E's address and its view key.
2. **Deposit:** a test wallet sends a few credits privately to E. Both sides find the record with
   the view key.
3. **Joint signature:** `credits.aleo/transfer_private` from E back to the test wallet, signed
   jointly as in the table above, with a joint signature for the fee too.
4. **Prove and send:** prove locally with `Process::execute`, then broadcast.
5. **Pass or fail:** it passes if the network accepts it. Must fail: W alone can't sign, and a
   forged share from B is rejected locally and by the network.
6. **Then:** the same with USDCx, then B's pieces behind tlock.

Credits come first because the record rules are the same and there's no freeze-list proof.

## Questions for reviewers

1. **Soundness of the joint signature.** Does anything in request or transition verification
   depend on `r` being derived as `HashToScalar(sk_sig, nonce)`, or on a single holder of the key?
   Does any check differ between the console verify and the circuit verify that a split key would
   trip?
2. **`sk_tag` and record tags.** Both sides know the view key, so both can compute `sk_tag` and
   the tags. Is that a problem for E, or for anything the network assumes about tags?
3. **Is something better coming?** Program-owned records, time-locked records or native escrow
   would make all of this unnecessary. If one is on the roadmap, we'd rather wait for it.
4. **Wallet support.** Could Shield, or Aleo wallets generally, hold one share and co-sign? Then
   payouts would still show up in the user's own wallet.
5. **Fees.** Can a fee be authorized by a different account than the execution's signer
   (`authorize_fee_public` / `authorize_fee_private` in `synthesizer-process/src/authorize.rs`)? Then the
   worker's own wallet could pay E's fees.
6. **USDCx.** Is there any concern, from the issuer's side or for compliance, about money held in
   an account two parties control together?
7. **The ecosystem.** Is there anything here that cuts against how Provable or the Aleo community
   want things done, or that would cause trouble for anyone? We'd rather hear that now.

Replies can go to Joshua directly, or as an issue or PR comment on this repository.
