---
status: report
updated: 2026-11-05
summary: What zPass is today (an issuer-signed credential proven in zero knowledge; an SDK from early 2025; example programs on testnet only), why Hewn can't use its SDK as it is, where it fits (verified identity, age, sanctions; not the I-9 yet), the missing piece (an issuer), and the recommended path.
---

# zPass: what it is, and how Hewn could use it

**Status:** report, from the exploration in `docs/PAYROLL_COMPLIANCE.md` part 7 (Joshua,
2026-11-05). Read from the source: the official SDK's repository and npm package, the deployed
programs on the explorer, the zPass docs and site, and Aleo's posts. Nothing here is built; the
recommendation at the end is for Joshua to decide.

## What zPass is

zPass is Aleo's protocol for proving facts about a person's identity without handing over the
document behind them. Its model has three parties
([docs](https://zpass.docs.aleo.org/fundamentals/the-off-chain-flow),
[site](https://zpass.aleo.org/)):

1. **An issuer** (an identity provider, a business or a government agency) checks the person's
   identity its own way, then signs a credential with an Aleo key: date of birth, nationality, an
   expiry, the issuer, and the person's Aleo address.
2. **The holder** turns the signed credential into a private `ZPass` record in their own wallet. The
   program checks the issuer's signature and stores salted commitments to each attribute, never
   the values (`zpass_hiding`).
3. **A verifier** (an app or a business) asks for a proof of a statement ("over 18", "not from a
   sanctioned country") and gets a zero-knowledge proof, on chain or off it, that the holder's
   record satisfies it. It learns the answer and nothing else.

The site's demo shows exactly that: an identity provider emails an invitation, the wallet accepts
the zPass, and a crypto bank later asks for "Age (over 18)" and "Citizenship (Non-Sanctioned
Country)".

## What exists today

| Piece | What we found |
|---|---|
| **The SDK** | `zpass-sdk` 0.1.3 on npm, Apache-2.0, from `AleoNet/zPass-SDK-new`; last published February 2025; built on `@provablehq/sdk` 0.8. Methods: `signCredential`, `issueZPass`, `getZPassRecord`, `proveOnChain`, `proveOffChain`, `verifyOnChain`, `verifyOffChain`, plus Merkle helpers |
| **The programs** | Examples in the SDK's repository (`zpass_hiding`, `verify_poseidon2_zpass`, `zpass_merkle_8`, invalidation variants), written in Leo before version 4 |
| **On chain** | Three of them deployed on **testnet** (`verify_poseidon2_zpass`, `zpass_merkle_8`, `verify_poseidon2`, July 2025), and the issuance counter is empty: no zPass has been issued with them. **None on mainnet** under those names |
| **In production** | "The zPass Five" (Aleo, February 24, 2025): Playside (young gamers), World3 (games), Humine (clinical trials), GeniiDAO (learning credentials), Three of Cups (meeting in person). None in employment or payroll |
| **Passports** | The docs describe passports as a natively signed source in principle. The SDK has no passport-chip reader; in practice the issuer model above is how a credential is made |
| **The regulatory signal** | On September 8, 2026, FinCEN and the federal banking agencies said banks and credit unions may verify customers with verifiable digital credentials, including state mobile driver's licenses, and with credentials from private issuers that authenticate to the bank's own standard ([Aleo, October 1, 2026](https://aleo.org/post/fincen-digital-credential-guidance/)). That is banking's customer identification, not employment |

## Why Hewn can't use the SDK as it is

- **It signs with a pasted private key** and submits transactions itself. Hewn's rules are that
  every on-chain write is signed in the user's Shield wallet (INV-11) and nothing uses the SDK's
  execute path (INV-12). The SDK would have to be bypassed for every write.
- **Its programs predate Leo 4,** and new programs on today's network have to be compiled with Leo
  4. Hewn would use its own version of the program, or canonical ones if Aleo deploys them.
- **Its example program keeps a public issuance counter,** which Hewn's programs never do (no
  cumulative counters in public state).
- **Its dependencies are old** (`@provablehq/sdk` 0.8), against Hewn's pinned versions.

The cryptography is the useful part, and it's small: verify an issuer's signature over a
credential, commit to each attribute with a salt, prove statements about the committed values.
That is a pattern Hewn can carry in its own Leo program, signed in Shield, with Leo tests.

## Where it fits in Hewn, and where it doesn't

**Not the I-9, today.** The I-9 requires the employer to examine the worker's original documents
(in person, or by live video for employers enrolled in E-Verify). We found nothing saying USCIS
accepts a zero-knowledge credential in place of that. Until it does, zPass can't stand in for the
I-9's document check (to confirm with USCIS when the I-9 design is written).

**Where it does fit:**

1. **A "verified person" mark on the registry.** A worker or customer whose `name.hewn` is backed by
   an issuer-verified zPass. Businesses hiring from the job board know the applicant is a real,
   verified person, without seeing a document. It answers fake accounts, which a free registry
   invites.
2. **Age, for work with age rules.** Federal and state child labor rules limit hours and jobs for
   minors; "over 18" (or "over 16") proven without a birth date protects both sides.
3. **Sanctions screening.** "Not a national of a sanctioned country", as the demo shows: a check
   payroll and stablecoin compliance increasingly ask for, proven without a passport.
4. **The W-4's identity.** Optional extra strength for "reasonably certain" (`docs/PAYROLL_COMPLIANCE.md`
   part 3), on top of the account and the agreement.
5. **Customers.** A business that needs to know its customer is an adult, or verified, asks for a
   proof rather than a document.

## The missing piece: an issuer

A zPass is only as good as whoever signed it, and no issuer for ordinary people is publicly named:
the five production projects issue their own credentials for their own users. Hewn can't be the
issuer itself without breaking its own design, because an issuer has to see and check the
document, and Hewn has no server and holds no one's documents. Three paths, in order of how soon
they could work:

1. **An identity provider that signs zPass credentials.** A KYC vendor checks the person (the usual
   photo-and-selfie flow, on the vendor's side, under the vendor's retention rules) and signs a
   zPass credential to their Aleo address. Hewn only ever sees proofs. This is what the zPass site's
   demo shows. It needs a vendor that does this, which is the first question for Aleo.
2. **State mobile driver's licenses.** An mDL is already signed by the state (a standard, ISO/IEC
   18013-5), and phones can present one. A program that verifies the state's signature itself would
   need no issuer in between: the state is the issuer. It is the most private and the most work
   (verifying the state's signature in a proof), and it depends on which states issue mDLs and how
   a web app inside Shield can ask for one.
3. **The employer, after the I-9.** The I-9 has the employer examine the worker's documents anyway.
   The employer could then sign a credential, "identity documents examined by this business on this
   date", that the worker carries to the registry and to future employers as proof they are a
   verified person (though each new employer still completes its own I-9, as the law requires).
   Every business on Hewn becomes an issuer for its own people. It needs no vendor, but the
   credential is only as trusted as the business behind it.

## Recommendation

1. **Talk to the zPass team first** (the site's "Get in touch"). Ask: are canonical zPass programs
   coming to mainnet, compiled with Leo 4? Which identity providers issue zPass credentials today?
   Is there a path for state mDLs? Does it work with Shield, signed in the wallet rather than with a
   pasted key? Their answers decide between building on their programs and carrying the pattern in
   ours.
2. **Meanwhile, design path 3**, the employer as issuer after the I-9, because it needs nobody
   else and fits what Hewn already does: the I-9 design (`docs/PAYROLL_COMPLIANCE.md` part 6) gains
   a final step that issues the credential.
3. **First use: the "verified person" mark and "over 18"** on the registry and the job board.
4. **Any program for it is new Leo:** say so first (INV-22), Fable 5.1 at high effort, with
   must-fail tests (a forged issuer signature, an expired credential, a revoked one, a proof about
   someone else's record).

## Sources

- The zPass SDK: `AleoNet/zPass-SDK-new` (read 2026-11-05, last commit 2025-02-24) and the
  `zpass-sdk` npm package
- [zPass docs: the off-chain flow](https://zpass.docs.aleo.org/fundamentals/the-off-chain-flow)
- [zpass.aleo.org](https://zpass.aleo.org/)
- [Introducing the zPass Five](https://aleo.org/post/first-projects-to-integrate-zpass/) (Aleo,
  February 24, 2025)
- [Identity Verification Is Broken. A Quiet Regulatory Shift Points Toward a Fix.](https://aleo.org/post/fincen-digital-credential-guidance/)
  (Aleo Network Foundation, October 1, 2026)
- The explorer: `verify_poseidon2_zpass.aleo`, `zpass_merkle_8.aleo`, `verify_poseidon2.aleo` on
  testnet, and none of them on mainnet (read 2026-11-05)
