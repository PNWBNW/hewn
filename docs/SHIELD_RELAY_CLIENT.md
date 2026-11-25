---
status: design
updated: 2026-11-25
summary: A Rust client for Shield's relay, so the desktop app pairs with Shield on a phone on its own rails (Tauri now, the GPUI client later): what the protocol is, read from adapter 1.6.0's source, the crate, the two ways to wire it into Tauri, where the pairing is kept, the threats, the tests, and the questions for Provable.
---

# A Rust client for Shield's relay

**The question.** The desktop app (`apps/desktop`) can't reach Shield: no extension runs inside it,
so every screen that needs Shield says it isn't available. Every account needs Shield (INV-13), so
the app can't be used until it can pair with Shield on a phone. Joshua decided on 2026-11-25 that
the desktop builds get their own rails and the website's pairing (`packages/wallet`, #373) stays
the website's.

**The proposal.** A small Rust crate, `shield-relay`, speaks Shield's relay protocol: it mints the
pairing, draws nothing, and sends requests to Shield on the phone and reads the answers. The Tauri
app uses it from its Rust side now. The GPUI client (`apps/native`) uses the same crate when it
gets screens. The website keeps the TypeScript adapter.

**What Joshua decides here:** the wiring (A or B, below; A recommended), where a finished pairing
is kept (below; the operating system's credential store recommended), and whether the questions at
the end go to Provable before the crate is built or alongside it.

Nothing here is built. Everything about the protocol below is read from the installed adapter's
source, `@provablehq/aleo-wallet-adapter-shield` 1.6.0 (`src/relay/protocol.ts`, `transport.ts`,
`linkForm.ts`, `remoteDefaults.ts`), whose protocol file says it is vendored from
`ProvableHQ/shield-relay` at commit `5bdacc5` and will be deleted "when the relay clients are
published". It is not a published specification; the questions at the end ask for one.

## How Shield's relay works (protocol version 1)

Two peers, the app (`dapp`) and Shield (`wallet`), meet in one channel on a relay that only
forwards. The relay is Centrifugo at `wss://relay.shield.app` (websocket path
`/connection/websocket`); a pairing's channel is `relay:<channelId>`, the id a random UUID.

1. **The app mints a pairing:** a channel id, a fresh secp256k1 key pair, and a 32-byte pairing
   secret. It joins the channel and shows the pairing link:
   `https://connect.shield.app/connect#channelId=…&pubkey=…&relay=…&origin=…&secret=…&v=1`.
   On an `https:` link every parameter is after the `#`, so the page at that address never receives
   the secret if Shield isn't installed. A phone's camera hands the link only to the signed Shield
   app (a verified link). The app's first request (`req`) rides in the link only on a phone; a
   computer sends it over the channel, which keeps the QR code to about 300 characters.
2. **Shield joins and answers with its key:** a plaintext `key_handshake` carrying Shield's public
   key and a MAC: HMAC-SHA256, keyed by the pairing secret, over the JSON text of
   `["shield-relay-key-handshake-v1", 1, channelId, origin, appPublicKey, walletPublicKey]` (keys in
   lower-case hex). Only someone who saw the link knows the secret, so the MAC is what stops the
   relay from slipping in its own key. The relay's address is deliberately not in it.
3. **Everything after that is sealed.** A message is `{seq, msg}` as JSON text, signed (ECDSA over
   secp256k1, the compact signature over SHA-256 of that exact text), and the pair
   `{sealed, sig}` is encrypted to the peer with ECIES (secp256k1, HKDF-SHA256, AES-256-GCM; the
   `eciesjs` defaults: an uncompressed ephemeral key and a 16-byte nonce) and sent as base64.
   The signature says who sent it, since anyone can encrypt to a public key. `seq` must rise
   strictly: each side keeps the highest it has seen and drops anything not above it, so a replay
   (by the relay, or the relay's history) is dropped. A sender starts its count at the clock's
   milliseconds, so a sender that lost its count still counts up.
4. **Requests mirror the extension's methods:** `connect` (network, decrypt permission, programs,
   options including the app's declared name and icon), `executeTransaction`, `signMessage`,
   `decrypt`, `requestRecords`, `transactionStatus`, `getBalances`, `disconnect` and the rest. Each
   carries the declared `origin`. Answers are `{kind: "response", id, result | error}`; Shield also
   sends events (`accountChanged`, `disconnect`). A request waits five minutes, then times out.
5. **Presence:** the relay's join, leave and presence tell the app whether Shield is in the channel
   now (it leaves whenever the phone puts it in the background); messages sent while it is away wait
   in the channel's history.
6. **Every message on the channel is wrapped** as `{from: "dapp" | "wallet", payload}`, and each
   side ignores its own.

**The declared origin.** The app names itself to Shield with an origin, and Shield shows it on every
approval. The adapter accepts only an `https:` origin (or a local `http:` one). It is self-asserted:
any program can claim any origin. Provable's advice (2026-11-23) was for the desktop app to declare
the website's origin, `https://www.hewnaccounting.com`, with the name from `@pnw/brand`.

## The crate

`shield-relay`, a library with no window and no knowledge of Hewn: it takes the relay's address,
the declared origin and name, and storage it is handed, and gives back the pairing link, a
`request(method, params)` and a stream of events. Its own Cargo workspace member under
`apps/native/` (where the seven-day crate check, the source check and `native.yml` already run);
the Tauri app depends on it by path, so both apps build the same code.

| Need | Crate | Note |
|---|---|---|
| ECIES | `ecies` (the Rust implementation by `eciesjs`'s author) | Built to be compatible; its defaults must match the ones above, proved by vectors from the TypeScript |
| Signatures | `k256` (RustCrypto) | Sign the SHA-256 digest as a prehash, deterministic (RFC 6979), low-S, compact 64 bytes |
| MAC | `hmac`, `sha2` | Compared in constant time |
| Websocket | `tokio-tungstenite` | `wss` only, to `relay.shield.app` only |
| Centrifugo | Our own, the few commands used | No official Rust client; the JSON protocol's connect, subscribe, publish, presence, join and leave, and history recovery |
| Secrets in memory | `zeroize` | The private key and the pairing secret wiped on drop |

Exactness traps, each covered by a test vector: the MAC's transcript must be byte for byte what
JavaScript's `JSON.stringify` writes; the signature is checked over the sealed text as it arrived,
never as re-serialized; hex is lower case; base64 is standard with padding (base64url only for the
phone's bundled request, which this client never sends); `seq` is a safe integer
(at most 2^53 − 1).

The pairing link is built and checked by the same rules `desktopPairingLink` applies on the
website: the verified link's address only, every parameter after the `#`, the relay
`wss://relay.shield.app` only, no `req`.

## Wiring it into Tauri: two ways

The app's transactions are built in the web bundle (TypeScript), so the bundle has to hand each
request to whatever talks to Shield.

**A. Rust holds the pairing; the bundle asks it (recommended).**
- One Tauri command, `shield_request(method, params)`, plus the pairing link and events, granted by a
  capability to the app's own origin only.
- In the bundle, a desktop adapter in `packages/wallet` with the same interface as Shield's, chosen
  only inside the desktop app (`useDesktopApp`). The website's adapter, its pairing and its files
  are untouched; the one shared line is the choice of adapter. Every send still goes through
  `checkedSend` (the edition check, the fee mode, INV-11 and `scripts/check_signing_path.py`).
- The pairing secret, the private key and the channel never enter the webview, so a script in the
  page can't read or copy them; the page can only ask for a request, which the person still has to
  approve on the phone.
- The cost: the app's rule "no bridge from the pages to the app" (`apps/desktop/README.md`) becomes
  "one bridge, one command, the app's own origin only", and the security policy adds Tauri's IPC
  address. A script in the page could then ask Shield for an approval, as it can on the website
  today; it can't approve one.
- The same crate serves the GPUI client, with no webview at all.

**B. The website's TypeScript adapter, run inside the webview.**
- What #373 first did: the adapter, with the website's origin declared and the pair route.
- No bridge and the least code, but the desktop app shares the website's pairing code, the
  pairing secret lives in the webview's storage, and nothing carries over to GPUI. It is the
  shared rail Joshua chose not to take.

## Where a finished pairing is kept

An unfinished pairing (Shield never answered) is never kept: closing the code ends it, as on the
website (`forgetUnfinishedPairing`). A finished one is what lets the app reopen without a new code.

| Option | For | Against |
|---|---|---|
| **The operating system's credential store** (Windows Credential Manager, through `keyring`) **(recommended)** | Out of the webview and out of plain files; Windows guards it per user | Another program running as the same person can read it, as with the books' "stay logged in" (`docs/THREAT_MODEL.md` T2) |
| Memory only | Nothing kept on the device | A new code every start of the app |
| Inside the encrypted books | Locked with the passphrase | The books live in the webview; Rust can't open them without another bridge |

Log out forgets it, as it forgets the remembered login.

## Threats

- **The code on screen (T3).** Whoever scans it first pairs. It is shown only on the pairing
  screen, never logged, stored or sent; it pairs with nothing after five minutes; Cancel ends it at
  once. A photograph of it is only good for that window.
- **A claimed origin.** Anyone can declare `https://www.hewnaccounting.com`. Shield shows the origin
  and every transaction in full on the phone; nothing is signed without the person's approval
  there. The idea in `docs/HOSTING.md` stands: Shield could check the app through its signed,
  anchored releases.
- **A malicious relay** can drop or delay messages, never read, change, forge or replay them (the
  MAC, the signatures and `seq`). It sees the channel id, the two public keys and when messages
  pass.
- **A script in the page (wiring A)** can ask for approvals, not make them, and can't reach the
  pairing's keys. Each approval appears on the phone.
- **Keys in memory and logs.** Wiped on drop; nothing here ever prints a key, the secret or the
  link (INV-06; the secrets scan stays the backstop).

## Tests

- **Vectors from the TypeScript itself.** A script runs the installed adapter's own
  `protocol.ts` to write fixtures: a transcript and its MAC, a sealed message encrypted in
  TypeScript to a Rust key and back, a pairing link built and parsed. The Rust tests read them, so
  a difference in either direction fails.
- **Negative:** a wrong MAC; a second handshake with another key; a message signed by anyone but
  the paired key; a replayed or lower `seq`; an unsafe or fractional `seq`; a malformed or
  oversized payload; a relay other than `relay.shield.app`; an origin that isn't `https:`; a link
  with a query, another host, or a `req`.
- **Live, ignored by default:** pair with Shield on a phone through the real relay and ask for
  `getBalances`.
- The crate goes through the seven-day check (OPS-04) like the rest of `apps/native`.

## Questions for Provable

1. Is relay protocol v1 stable, and will its specification and test vectors be published (the
   vendored file names the relay clients' publication, Linear WS-92)? Is a Rust client planned?
2. Does the relay accept a client that isn't a browser: no `Origin` header on the websocket, no
   token? Any rate limits?
3. Is a desktop app declaring the website's origin what Shield intends? Does it share the
   website's approvals and session in Shield, or start its own?
4. How long does the relay keep a channel's history, and how long does a channel live?
5. Would Shield check an app against its signed, anchored releases (`docs/HOSTING.md`), so the
   origin it shows is proved rather than declared?

## The pull requests after this one

1. **The crate** in `apps/native`, with the vectors and the negative tests; no Tauri, no screen.
2. **The Tauri wiring** (A or B as decided) and the desktop app's pairing screen: a screen, so it
   waits for Joshua's go.
3. **The test on Windows:** Joshua pairs the installed app with Shield on his phone, sets up an
   account on testnet and pays a run (step 3's exit, `docs/HOSTING.md`, whose wording moves to
   Windows only, as decided on 2026-11-25).
