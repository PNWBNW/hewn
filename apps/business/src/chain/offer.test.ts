// Sending an offer: the 16 inputs against the portal's own encoding, dates
// as block heights, the mailbox-first ordering with a fake client and a fake
// wallet, and the link that comes out of it.
import { describe, expect, it } from "vitest";
import { VERSIONS } from "@pnw/config/programs";
import { computeAgreementValues, computeTermsDocHash } from "@pnw/handshake/engine";
import { KINDS, MailboxError, lookupId, open, partiesKeyFromHex } from "@pnw/mailbox";
import { type Rail, addLink, linkFor, linkStatus, markLinked } from "../books/rail";
import {
  FREQUENCY_CODES,
  MAILBOX_OFF_MESSAGE,
  NO_NAME_MESSAGE,
  OFFER_FUNCTION,
  OFFER_PROGRAM,
  type SendOfferInput,
  TERMS_SLOT,
  awaitAccepted,
  bareHex,
  bytesToAleoU8Array,
  createJobOfferInputs,
  dateToHeight,
  fetchLatestHeight,
  finalAgreementIds,
  isMailboxOff,
  offerEpochs,
  resolveWorker,
  sendOffer,
} from "./offer";
import { canonicalTerms, parseTerms } from "./terms";

const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const WORKER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const EMPLOYER_HASH = "123456789012345678901234567890";
const WORKER_HASH = "987654321098765432109876543210";
const NOW = new Date("2026-10-14T15:04:05.000Z");
const HEIGHT = 4_210_000;
const WALLET_ID = "shield_42";
const TX = "at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw";

const worker = { id: "wkr-1", payType: "hourly" as const, rate: 3000n, frequency: "biweekly" as const };

// ---- The portal's encoding, copied verbatim as the reference ------------------------------
const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n;
function portalBytesToAleoU8Array(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return "[ " + bytes.map((b) => `${b}u8`).join(", ") + " ]";
}
function portalFieldFromHash(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  let value = 0n;
  for (let i = 0; i < clean.length; i += 2) value = (value << 8n) | BigInt(parseInt(clean.slice(i, i + 2), 16));
  return (value % FIELD_MODULUS).toString(10);
}
function portalInputs(computed: ReturnType<typeof computeAgreementValues>, e: { employerNameHash: string; workerNameHash: string; workerAddress: string; industryCode: number; payFrequency: number; startEpoch: number; endEpoch: number; reviewEpoch: number }) {
  const empHash = e.employerNameHash.replace(/field$/, "").trim();
  const wrkHash = e.workerNameHash.replace(/field$/, "").trim();
  return [
    portalBytesToAleoU8Array(computed.agreement_id),
    portalBytesToAleoU8Array(computed.parties_key),
    `${empHash}field`,
    `${wrkHash}field`,
    e.workerAddress,
    `${e.industryCode}u8`,
    `${e.payFrequency}u8`,
    `${e.startEpoch}u32`,
    `${e.endEpoch}u32`,
    `${e.reviewEpoch}u32`,
    `1u16`,
    `${VERSIONS.schema_v}u16`,
    `${VERSIONS.policy_v}u16`,
    portalBytesToAleoU8Array(computed.terms_doc_hash),
    portalBytesToAleoU8Array(computed.terms_root),
    portalBytesToAleoU8Array(computed.offer_time_hash),
  ];
}

// ---- Fakes -------------------------------------------------------------------------------
type Put = { lookup: string; envelope: Uint8Array };
function fakeClient(...answers: (number | Error)[]) {
  const puts: Put[] = [];
  return {
    puts,
    async put(lookup: string, envelope: Uint8Array) {
      puts.push({ lookup, envelope: new Uint8Array(envelope) });
      const a = answers.shift() ?? 201;
      if (a instanceof Error) throw a;
      if (a === 409) throw new MailboxError("CONFLICT", "taken");
      if (a === 503) throw new MailboxError("NOT_CONFIGURED", "off");
      if (a >= 400) throw new MailboxError("REQUEST_FAILED", `failed (${a})`);
    },
  };
}
function fakeWallet({ polls = 2, outcome = "accepted" as "accepted" | "rejected" } = {}) {
  const calls: { program: string; function: string; inputs: string[]; privateFee: false }[] = [];
  let asked = 0;
  return {
    calls,
    async executeTransaction(opts: { program: string; function: string; inputs: string[]; fee?: number; privateFee: false }) {
      calls.push({ program: opts.program, function: opts.function, inputs: opts.inputs, privateFee: opts.privateFee });
      return { transactionId: WALLET_ID };
    },
    async transactionStatus(id: string) {
      if (id !== WALLET_ID) throw new Error("unknown");
      asked++;
      if (asked < polls) return { status: "pending" };
      return outcome === "accepted" ? { status: "accepted", transactionId: TX } : { status: "rejected", error: "no" };
    },
  };
}
let tick = 0;
const instant = { clock: { now: () => (tick += 1000) }, sleep: async () => {} };

function input(over: Partial<SendOfferInput> = {}): SendOfferInput {
  return {
    employerAddress: EMPLOYER,
    employerNameHash: EMPLOYER_HASH,
    businessName: "dayco",
    worker,
    workerAddress: WORKER,
    workerNameHash: `${WORKER_HASH}field`,
    industryCode: 9,
    termsText: "Carpenter, 40 hours a week.",
    startDate: "2026-11-02",
    reviewDate: "2027-01-31",
    endDate: "",
    currentHeight: HEIGHT,
    client: fakeClient(201),
    wallet: fakeWallet(),
    now: () => NOW,
    ...instant,
    ...over,
  };
}

// ---- Encoding ------------------------------------------------------------------------------
describe("create_job_offer inputs", () => {
  const computed = computeAgreementValues(EMPLOYER, WORKER, '{"version":1,"kind":"terms"}', 1_760_454_245);

  it("match the portal's 16 inputs, order and encodings, for the same computed values", () => {
    const ours = createJobOfferInputs({ computed, employerNameHash: `${EMPLOYER_HASH}field`, workerNameHash: WORKER_HASH, workerAddress: WORKER, industryCode: 9, frequencyCode: 3, epochs: { start: 4_210_100, end: 0, review: 4_211_000 } });
    const theirs = portalInputs(computed, { employerNameHash: `${EMPLOYER_HASH}field`, workerNameHash: WORKER_HASH, workerAddress: WORKER, industryCode: 9, payFrequency: 3, startEpoch: 4_210_100, endEpoch: 0, reviewEpoch: 4_211_000 });
    expect(ours).toEqual(theirs);
    expect(ours).toHaveLength(16);
    expect(ours[10]).toBe("1u16");
    expect(ours[11]).toBe("2u16");
    expect(ours[12]).toBe("1u16");
  });

  it("encode bytes as the portal did, and name hashes stay the registry's decimal field", () => {
    expect(bytesToAleoU8Array("0x0102ff")).toBe("[ 1u8, 2u8, 255u8 ]");
    expect(bytesToAleoU8Array("0102ff")).toBe(portalBytesToAleoU8Array("0x0102ff"));
    expect(bytesToAleoU8Array(computed.agreement_id).match(/u8/g)).toHaveLength(32);
    // A name hash is already a decimal field; the portal never ran it through fieldFromHash.
    expect(portalFieldFromHash("0xff")).toBe("255");
    expect(bareHex("0xABcd")).toBe("abcd");
  });

  it("map the books' pay frequencies to the agreement's codes", () => {
    expect(FREQUENCY_CODES).toEqual({ weekly: 2, biweekly: 3, semimonthly: 3, monthly: 4 });
  });
});

// ---- Epochs ----------------------------------------------------------------------------
describe("dates as block heights", () => {
  const nowMs = NOW.getTime();

  it("count about one block every 3 seconds from the current height, never before it", () => {
    expect(dateToHeight("2026-10-15", HEIGHT, nowMs)).toBe(HEIGHT + Math.floor(((Date.UTC(2026, 9, 15) - nowMs) / 1000) * (1 / 3)));
    expect(dateToHeight("2026-10-15", HEIGHT, Date.UTC(2026, 9, 14))).toBe(HEIGHT + 28_800);
    expect(dateToHeight("2026-10-01", HEIGHT, nowMs)).toBe(HEIGHT); // in the past: now
    expect(dateToHeight("2026-10-14", HEIGHT, nowMs)).toBe(HEIGHT); // earlier today: now
    expect(() => dateToHeight("soon", HEIGHT, nowMs)).toThrow(/date/);
  });

  it("give start, review (never before start) and end (0 = open-ended)", () => {
    const e = offerEpochs({ startDate: "2026-11-02", reviewDate: "2027-01-31", endDate: "" }, HEIGHT, nowMs);
    expect(e.start).toBe(dateToHeight("2026-11-02", HEIGHT, nowMs));
    expect(e.review).toBe(dateToHeight("2027-01-31", HEIGHT, nowMs));
    expect(e.end).toBe(0);
    expect(offerEpochs({ startDate: "2026-11-02", reviewDate: "2026-10-01" }, HEIGHT, nowMs).review).toBe(e.start);
    expect(offerEpochs({ startDate: "2026-11-02", reviewDate: "2027-01-31", endDate: "2027-11-01" }, HEIGHT, nowMs).end).toBeGreaterThan(e.start);
    expect(() => offerEpochs({ startDate: "2026-11-02", reviewDate: "2027-01-31", endDate: "2026-11-02" }, HEIGHT, nowMs)).toThrow(/end date/);
    expect(() => offerEpochs({ startDate: "2026-11-02", reviewDate: "2027-01-31" }, -1, nowMs)).toThrow(/block height/);
  });

  it("read the current height from the explorer", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response("4210777", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    expect(await fetchLatestHeight(fetchImpl, "https://explorer.example/v2/testnet/")).toBe(4_210_777);
    expect(calls).toEqual(["https://explorer.example/v2/testnet/block/height/latest"]);
    const down = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchLatestHeight(down, "https://explorer.example")).rejects.toThrow(/block height/);
    const odd = (async () => new Response('"4210777u32"', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchLatestHeight(odd, "https://explorer.example")).rejects.toThrow(/block height/);
  });
});

// ---- Who ----------------------------------------------------------------------------------
describe("resolveWorker", () => {
  const reg = {
    nameOwner: async (hash: string) => (hash === "7" ? WORKER : null),
    workerName: async (address: string) => (address === WORKER ? "7field" : null),
    namePlaintext: async (hash: string) => (hash === "7" ? "ana" : null),
  };
  // computeNameHash is deterministic; the fake registry answers only for its result.
  it("resolves a name (with or without the suffix) to its owner, and an account to its name", async () => {
    const { computeNameHash } = await import("@pnw/records/registry/name_registry");
    const hash = computeNameHash("ana");
    const r = { ...reg, nameOwner: async (h: string) => (h === hash ? WORKER : null) };
    expect(await resolveWorker("Ana", "hewn", r)).toEqual({ address: WORKER, nameHash: hash, name: "ana" });
    expect(await resolveWorker(" ana.hewn ", "hewn", r)).toEqual({ address: WORKER, nameHash: hash, name: "ana" });
    expect(await resolveWorker(WORKER, "hewn", reg)).toEqual({ address: WORKER, nameHash: "7", name: "ana" });
    await expect(resolveWorker("nobody", "hewn", r)).rejects.toThrow(NO_NAME_MESSAGE);
    await expect(resolveWorker("aleo1" + "q".repeat(58), "hewn", reg)).rejects.toThrow(NO_NAME_MESSAGE);
    await expect(resolveWorker("aleo1short", "hewn", reg)).rejects.toThrow(/63 characters/);
    await expect(resolveWorker("", "hewn", reg)).rejects.toThrow(/name or account/);
  });
});

// ---- Sending -------------------------------------------------------------------------------
describe("sendOffer", () => {
  it("puts the sealed terms in slot 0 of the mailbox, then sends create_job_offer with privateFee false, then returns an offered link", async () => {
    const client = fakeClient(201);
    const wallet = fakeWallet();
    const stages: string[] = [];
    const sent = await sendOffer(input({ client, wallet, onProgress: (s) => stages.push(s) }));

    // Mailbox first, then the wallet.
    expect(stages).toEqual(["sealing", "mailbox", "approving", "sent", "accepted"]);
    expect(client.puts).toHaveLength(1);
    expect(wallet.calls).toHaveLength(1);
    const call = wallet.calls[0]!;
    expect(call.program).toBe(OFFER_PROGRAM);
    expect(call.function).toBe(OFFER_FUNCTION);
    expect(call.privateFee).toBe(false);
    expect(call.inputs).toEqual(sent.inputs);
    expect(sent.transactionId).toBe(TX);
    expect(sent.slotTaken).toBe(false);

    // The link: offered, with the values the record will carry.
    const canonical = canonicalTerms(sent.terms);
    const computed = computeAgreementValues(EMPLOYER, WORKER, canonical, Math.floor(NOW.getTime() / 1000));
    expect(sent.link).toEqual({
      workerId: "wkr-1",
      address: WORKER,
      nameHash: WORKER_HASH,
      agreementId: bareHex(computed.agreement_id),
      partiesKey: bareHex(computed.parties_key),
      status: "offered",
      offeredAt: NOW.toISOString(),
    });
    expect(sent.link.partiesKey).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.link.agreementId).toMatch(/^[0-9a-f]{64}$/);

    // The inputs are the portal's, for these computed values.
    expect(call.inputs).toEqual(
      portalInputs(computed, { employerNameHash: EMPLOYER_HASH, workerNameHash: WORKER_HASH, workerAddress: WORKER, industryCode: 9, payFrequency: 3, startEpoch: dateToHeight("2026-11-02", HEIGHT, NOW.getTime()), endEpoch: 0, reviewEpoch: dateToHeight("2027-01-31", HEIGHT, NOW.getTime()) }),
    );

    // The terms: pay from the worker record, the offer time hash in agreementId, and the hash on the record.
    expect(sent.terms).toEqual({ version: 1, kind: "terms", agreementId: bareHex(computed.offer_time_hash), termsText: "Carpenter, 40 hours a week.", payType: "hourly", rate: "3000", frequency: "biweekly", startDate: "2026-11-02", businessName: "dayco", offeredAt: NOW.toISOString() });
    expect(computeTermsDocHash(canonical)).toBe(computed.terms_doc_hash);
    expect(call.inputs[13]).toBe(bytesToAleoU8Array(computed.terms_doc_hash));

    // The envelope opens with the parties key, kind terms, slot 0, and holds exactly the canonical terms.
    const key = partiesKeyFromHex(sent.link.partiesKey!);
    const put = client.puts[0]!;
    expect(put.lookup).toBe(lookupId(key, KINDS.terms, TERMS_SLOT));
    expect(put.envelope[0]).toBe(0x01);
    const opened = new TextDecoder().decode(await open(key, KINDS.terms, 0, put.envelope));
    expect(opened).toBe(canonical);
    expect(parseTerms(opened)).toEqual(sent.terms);
    await expect(open(key, KINDS.paystub, 0, put.envelope)).rejects.toThrow();
    const wire = new TextDecoder("utf-8", { fatal: false }).decode(put.envelope);
    expect(wire).not.toMatch(/Carpenter|dayco|3000/);
  });

  it("stops before any transaction when the mailbox is off (503)", async () => {
    const client = fakeClient(503);
    const wallet = fakeWallet();
    await expect(sendOffer(input({ client, wallet }))).rejects.toThrow(MAILBOX_OFF_MESSAGE);
    expect(client.puts).toHaveLength(1);
    expect(wallet.calls).toEqual([]);
    let caught: unknown;
    await sendOffer(input({ client: fakeClient(503), wallet })).catch((e) => (caught = e));
    expect(isMailboxOff(caught)).toBe(true);
    expect(isMailboxOff(new MailboxError("NOT_CONFIGURED", "off"))).toBe(true);
    expect(isMailboxOff(new Error("off"))).toBe(false);
  });

  it("goes on when the slot is already taken (409): the terms are already there", async () => {
    const client = fakeClient(409);
    const wallet = fakeWallet();
    const sent = await sendOffer(input({ client, wallet }));
    expect(sent.slotTaken).toBe(true);
    expect(wallet.calls).toHaveLength(1);
    expect(sent.link.status).toBe("offered");
  });

  it("stops before any transaction on any other mailbox failure", async () => {
    const wallet = fakeWallet();
    await expect(sendOffer(input({ client: fakeClient(502), wallet }))).rejects.toThrow(/502/);
    await expect(sendOffer(input({ client: fakeClient(new TypeError("Failed to fetch")), wallet }))).rejects.toThrow(/Failed to fetch/);
    expect(wallet.calls).toEqual([]);
  });

  it("refuses before any request when something is missing", async () => {
    const client = fakeClient();
    const wallet = fakeWallet();
    await expect(sendOffer(input({ client, wallet, termsText: " " }))).rejects.toThrow(/Write the terms/);
    await expect(sendOffer(input({ client, wallet, employerNameHash: "" }))).rejects.toThrow(/business name/);
    await expect(sendOffer(input({ client, wallet, workerNameHash: "field" }))).rejects.toThrow(NO_NAME_MESSAGE);
    await expect(sendOffer(input({ client, wallet, workerAddress: "aleo1nope" }))).rejects.toThrow(/Find the person/);
    await expect(sendOffer(input({ client, wallet, industryCode: 0 }))).rejects.toThrow(/industry/);
    await expect(sendOffer(input({ client, wallet, endDate: "2026-11-02" }))).rejects.toThrow(/end date/);
    expect(client.puts).toEqual([]);
    expect(wallet.calls).toEqual([]);
  });

  it("reports a rejected transaction, and gives up when the wallet never answers", async () => {
    await expect(sendOffer(input({ wallet: fakeWallet({ outcome: "rejected" }) }))).rejects.toThrow(/didn't accept|no/);
    const silent = { ...fakeWallet(), transactionStatus: async () => ({ status: "pending" }) };
    await expect(awaitAccepted(silent, WALLET_ID, { ...instant, limits: { walletCapMs: 5000 } })).rejects.toThrow(/No answer from Shield/);
    const unknown = { ...fakeWallet(), transactionStatus: async () => { throw new Error("not yet"); } };
    await expect(awaitAccepted(unknown, WALLET_ID, { ...instant, limits: { walletCapMs: 5000 } })).rejects.toThrow(/No answer from Shield/);
    expect(await awaitAccepted(fakeWallet({ polls: 1 }), WALLET_ID, instant)).toBe(TX);
    const bare = { ...fakeWallet({ polls: 1 }), transactionStatus: async () => ({ status: "finalized" }) };
    expect(await awaitAccepted(bare, TX, instant)).toBe(TX);
  });
});

// ---- The link's life -----------------------------------------------------------------------
describe("offer → link", () => {
  const rail: Rail = { version: 1, network: "testnet", address: EMPLOYER, linkedAt: NOW.toISOString(), businessNameHash: EMPLOYER_HASH, businessName: "dayco", links: [] };

  it("records as offered, shows as Offer sent, and becomes linked once the acceptance is imported", async () => {
    const sent = await sendOffer(input());
    const offered = addLink(rail, sent.link);
    expect(linkStatus(rail, "worker", "wkr-1")).toBe("typed");
    expect(linkStatus(offered, "worker", "wkr-1")).toBe("offered");

    const plaintext = `{\n  owner: ${EMPLOYER}.private,\n  agreement_id: ${bytesToAleoU8Array(sent.link.agreementId)}.private,\n  worker_address: ${WORKER}.private\n}`;
    expect(finalAgreementIds([{ recordName: "PendingAgreement", spent: false, recordPlaintext: plaintext }])).toEqual(new Set());
    expect(finalAgreementIds([{ recordName: "FinalAgreement", spent: true, recordPlaintext: plaintext }])).toEqual(new Set());
    const finals = finalAgreementIds([{ recordName: "FinalAgreement", spent: false, recordPlaintext: plaintext }, null, "x"]);
    expect(finals).toEqual(new Set([sent.link.agreementId]));

    const linked = finals.has(sent.link.agreementId) ? markLinked(offered, "wkr-1", "2026-10-16T09:00:00.000Z") : offered;
    expect(linkStatus(linked, "worker", "wkr-1")).toBe("linked");
    expect(linkFor(linked, "wkr-1")).toEqual({ ...sent.link, status: "linked", linkedAt: "2026-10-16T09:00:00.000Z" });
  });

  it("keeps the offer time when the same agreement is imported as a full link", async () => {
    const sent = await sendOffer(input());
    const offered = addLink(rail, sent.link);
    const imported = addLink(offered, { workerId: "wkr-1", address: WORKER, nameHash: WORKER_HASH, agreementId: sent.link.agreementId, partiesKey: sent.link.partiesKey!, status: "linked", linkedAt: "2026-10-16T09:00:00.000Z" });
    expect(linkFor(imported, "wkr-1")).toEqual({ ...sent.link, status: "linked", linkedAt: "2026-10-16T09:00:00.000Z" });
  });
});
