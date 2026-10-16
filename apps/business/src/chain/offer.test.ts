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
  WITHDRAW_FUNCTION,
  awaitAccepted,
  bareHex,
  bytesToAleoU8Array,
  createJobOfferInputs,
  dateToHeight,
  fetchLatestHeight,
  isDerivedPartiesKey,
  newPartiesKey,
  finalAgreementIds,
  isMailboxOff,
  offerEpochs,
  resolveBusinessName,
  offerKeepUntil,
  offerLookups,
  sendOffer,
  withdrawOffer,
  withdrawOfferInputs,
} from "./offer";
import { offerTermsKind } from "./offer_files";
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
type Put = { lookup: string; envelope: Uint8Array; keepUntil?: string };
function fakeClient(...answers: (number | Error)[]) {
  const puts: Put[] = [];
  return {
    puts,
    async put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string }) {
      puts.push({ lookup, envelope: new Uint8Array(envelope), ...(options?.keepUntil ? { keepUntil: options.keepUntil } : {}) });
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
describe("create_offer_open inputs", () => {
  it("go to the open copy of create_job_offer (agreement v4 edition 2: no license approval)", () => {
    expect(OFFER_FUNCTION).toBe("create_offer_open");
    expect(OFFER_PROGRAM).toBe("employer_agreement_v4.aleo");
  });

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

describe("resolveBusinessName", () => {
  it("accepts a name only when this very account owns it", async () => {
    const { computeNameHash } = await import("@pnw/records/registry/name_registry");
    const hash = computeNameHash("dayco");
    const owns = async (h: string) => (h === hash ? EMPLOYER : null);
    expect(await resolveBusinessName(" DayCo.hewn ", "hewn", EMPLOYER, { nameOwner: owns })).toEqual({ nameHash: hash, name: "dayco" });
    expect(await resolveBusinessName("dayco", "hewn", EMPLOYER, { nameOwner: owns })).toEqual({ nameHash: hash, name: "dayco" });
  });

  it("refuses an unregistered name, someone else's name and an empty one", async () => {
    const { computeNameHash } = await import("@pnw/records/registry/name_registry");
    const hash = computeNameHash("dayco");
    await expect(resolveBusinessName("dayco", "hewn", EMPLOYER, { nameOwner: async () => null })).rejects.toThrow("No one has registered that name");
    await expect(resolveBusinessName("dayco", "hewn", EMPLOYER, { nameOwner: async (h) => (h === hash ? WORKER : null) })).rejects.toThrow("belongs to a different account");
    await expect(resolveBusinessName("  .hewn", "hewn", EMPLOYER, { nameOwner: async () => EMPLOYER })).rejects.toThrow(/business name/);
  });
});

// ---- Sending -------------------------------------------------------------------------------
describe("sendOffer", () => {
  it("with an offer letter: the files' pieces first, then the terms, then Shield; the terms carry the letter and each file's fingerprint", async () => {
    const { pickFile, fetchOfferFile } = await import("./offer_files");
    const { OFFER_CHUNK_BYTES } = await import("../books/offer_letter");
    const pdf = await pickFile("contract.pdf", "application/pdf", new Uint8Array(OFFER_CHUNK_BYTES + 5).map((_, i) => i & 0xff));
    const client = fakeClient();
    const wallet = fakeWallet();
    const stages: string[] = [];
    const letter = { description: "Framing crew lead.", requirements: "", handbook: "Steel toes on site.", other: "" };
    const sent = await sendOffer(input({ client, wallet, letter, files: [pdf], onProgress: (s) => stages.push(s) }));
    const legacySlot = lookupId(partiesKeyFromHex(sent.link.partiesKey!), KINDS.terms, TERMS_SLOT);
    expect(offerLookups({ ...sent.link, terms: sent.terms }).sort()).toEqual([...client.puts.map((p) => p.lookup), legacySlot].sort());
    expect(stages).toEqual(["files", "sealing", "mailbox", "approving", "sent", "accepted"]);
    expect(client.puts).toHaveLength(3); // two pieces, then the terms
    // Every piece and the terms may be swept the day after the offer expires (7 days on).
    expect(client.puts.map((p) => p.keepUntil)).toEqual(["2026-10-22", "2026-10-22", "2026-10-22"]);
    expect(offerKeepUntil(sent.terms.version === 2 ? sent.terms.expiresAt : "")).toBe("2026-10-22");
    expect(sent.terms.version).toBe(2);
    if (sent.terms.version !== 2) throw new Error("unreachable");
    expect(sent.terms.letter).toEqual(letter);
    expect(sent.terms.files).toEqual([pdf.file]);
    // The record's terms hash is over these terms, files and all.
    const computed = computeAgreementValues(EMPLOYER, WORKER, canonicalTerms(sent.terms), Math.floor(NOW.getTime() / 1000));
    expect(wallet.calls[0]!.inputs).toContain(bytesToAleoU8Array(computed.terms_doc_hash));
    // What the worker gets back from those pieces is the file, byte for byte.
    const slots = new Map(client.puts.map((p) => [p.lookup, p.envelope]));
    const back = await fetchOfferFile({ get: async (l) => { const v = slots.get(l); return v ? new Uint8Array(v) : null; } }, sent.link.partiesKey!, sent.terms.agreementId, sent.terms.files, 0);
    expect(back.bytes).toEqual(pdf.bytes);
  });

  it("refuses a letter over its limits before anything is sent", async () => {
    const client = fakeClient();
    const wallet = fakeWallet();
    const letter = { description: "x".repeat(20_001), requirements: "", handbook: "", other: "" };
    await expect(sendOffer(input({ client, wallet, letter }))).rejects.toThrow(/at most/);
    expect(client.puts).toHaveLength(0);
    expect(wallet.calls).toHaveLength(0);
  });

  it("sends nothing to Shield when a file piece can't be delivered", async () => {
    const { pickFile } = await import("./offer_files");
    const pdf = await pickFile("contract.pdf", "application/pdf", new Uint8Array(10));
    const off = fakeClient(503);
    const wallet = fakeWallet();
    await expect(sendOffer(input({ client: off, wallet, files: [pdf] }))).rejects.toThrow(MAILBOX_OFF_MESSAGE);
    expect(wallet.calls).toHaveLength(0);
  });

  it("puts the sealed terms in slot 0 of the mailbox, then sends create_offer_open with privateFee false, then returns an offered link", async () => {
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
    // Everything but the parties key comes from the portal's formulas; the key is random, never from the addresses.
    const computed = { ...computeAgreementValues(EMPLOYER, WORKER, canonical, Math.floor(NOW.getTime() / 1000)), parties_key: `0x${sent.link.partiesKey}` };
    expect(isDerivedPartiesKey(sent.link.partiesKey!, EMPLOYER, WORKER)).toBe(false);
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
    // Every new offer is version 2 (the offer letter); with nothing written and nothing attached, the letter is empty.
    expect(sent.terms).toEqual({
      version: 2,
      kind: "terms",
      agreementId: bareHex(computed.offer_time_hash),
      termsText: "Carpenter, 40 hours a week.",
      payType: "hourly",
      rate: "3000",
      frequency: "biweekly",
      startDate: "2026-11-02",
      businessName: "dayco",
      offeredAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(), // 7 days unless the business picks another window
      letter: { description: "", requirements: "", handbook: "", other: "" },
      files: [],
    });
    expect(computeTermsDocHash(canonical)).toBe(computed.terms_doc_hash);
    expect(call.inputs[13]).toBe(bytesToAleoU8Array(computed.terms_doc_hash));

    // The envelope opens with the parties key, the offer's own terms kind, slot 0, and holds exactly the canonical terms.
    const key = partiesKeyFromHex(sent.link.partiesKey!);
    const put = client.puts[0]!;
    const own = offerTermsKind(sent.link.agreementId);
    expect(put.lookup).toBe(lookupId(key, own, TERMS_SLOT));
    expect(put.lookup).not.toBe(lookupId(key, KINDS.terms, TERMS_SLOT));
    expect(put.envelope[0]).toBe(0x01);
    const opened = new TextDecoder().decode(await open(key, own, 0, put.envelope));
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

// ---- Withdrawing ---------------------------------------------------------------------------
describe("withdrawing an offer", () => {
  it("lets the business pick how long an offer stays open", async () => {
    const sent = await sendOffer(input({ expiresInDays: 14 }));
    expect(sent.terms.version === 2 && sent.terms.expiresAt).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
  });

  it("sends terminate_employer_open with the agreement, the parties key and both name hashes", async () => {
    const sent = await sendOffer(input());
    const inputs = withdrawOfferInputs(sent.link, EMPLOYER_HASH);
    expect(WITHDRAW_FUNCTION).toBe("terminate_employer_open");
    expect(inputs).toEqual([sent.inputs[0], sent.inputs[1], `${EMPLOYER_HASH}field`, `${WORKER_HASH}field`]);
    expect(withdrawOfferInputs(sent.link, `${EMPLOYER_HASH}field`)).toEqual(inputs);
    const { partiesKey: _k, ...old } = sent.link;
    expect(() => withdrawOfferInputs(old, EMPLOYER_HASH)).toThrow(/too old to withdraw/);
  });

  it("signs once with privateFee false, waits for it, then clears the terms and the files from the mailbox", async () => {
    const { pickFile } = await import("./offer_files");
    const pdf = await pickFile("contract.pdf", "application/pdf", new Uint8Array(300_000));
    const client = fakeClient();
    const sent = await sendOffer(input({ client, files: [pdf] }));
    const wallet = fakeWallet();
    const dropped: string[] = [];
    const tx = await withdrawOffer({ link: { ...sent.link, terms: sent.terms }, employerNameHash: EMPLOYER_HASH, wallet, client: { drop: async (l) => void dropped.push(l) }, ...instant });
    expect(tx).toBe(TX);
    expect(wallet.calls).toEqual([{ program: OFFER_PROGRAM, function: WITHDRAW_FUNCTION, inputs: withdrawOfferInputs(sent.link, EMPLOYER_HASH), privateFee: false }]);
    // Two file pieces, the terms, and the shared slot 0 older offers used.
    const legacySlot = lookupId(partiesKeyFromHex(sent.link.partiesKey!), KINDS.terms, TERMS_SLOT);
    expect(dropped.sort()).toEqual([...client.puts.map((p) => p.lookup), legacySlot].sort());
    expect(dropped).toHaveLength(4);
  });

  it("clears nothing when the withdrawal isn't accepted, and shrugs off a slot already gone", async () => {
    const sent = await sendOffer(input());
    const dropped: string[] = [];
    const drop = async (l: string) => void dropped.push(l);
    await expect(withdrawOffer({ link: sent.link, employerNameHash: EMPLOYER_HASH, wallet: fakeWallet({ outcome: "rejected" }), client: { drop }, ...instant })).rejects.toThrow();
    expect(dropped).toEqual([]);
    const gone = async () => { throw new MailboxError("REQUEST_FAILED", "gone"); };
    expect(await withdrawOffer({ link: sent.link, employerNameHash: EMPLOYER_HASH, wallet: fakeWallet(), client: { drop: gone }, ...instant })).toBe(TX);
  });
});

// ---- The parties key ----------------------------------------------------------------------
describe("the parties key", () => {
  it("is random for every new pair, never the one anyone could compute from the two addresses", async () => {
    const { computePartiesKey } = await import("@pnw/handshake/engine");
    const one = await sendOffer(input());
    const two = await sendOffer(input());
    expect(one.link.partiesKey).toMatch(/^[0-9a-f]{64}$/);
    expect(one.link.partiesKey).not.toBe(two.link.partiesKey);
    expect(one.link.partiesKey).not.toBe(bareHex(computePartiesKey(EMPLOYER, WORKER)));
    expect(isDerivedPartiesKey(bareHex(computePartiesKey(EMPLOYER, WORKER)), EMPLOYER, WORKER)).toBe(true);
    expect(newPartiesKey()).not.toBe(newPartiesKey());
  });

  it("goes on the chain, seals the terms and lands on the link", async () => {
    const client = fakeClient();
    const wallet = fakeWallet();
    const sent = await sendOffer(input({ client, wallet }));
    expect(wallet.calls[0]!.inputs[1]).toBe(bytesToAleoU8Array(sent.link.partiesKey!));
    const key = partiesKeyFromHex(sent.link.partiesKey!);
    expect(client.puts[0]!.lookup).toBe(lookupId(key, offerTermsKind(sent.link.agreementId), TERMS_SLOT));
  });

  it("is kept for a revision to the same person, so the conversation carries on", async () => {
    const own = newPartiesKey();
    const sent = await sendOffer(input({ partiesKey: own }));
    expect(sent.link.partiesKey).toBe(own);
    expect((await sendOffer(input({ partiesKey: `0x${own.toUpperCase()}` }))).link.partiesKey).toBe(own);
  });

  it("replaces an old address-derived key, and refuses one that isn't a key", async () => {
    const { computePartiesKey } = await import("@pnw/handshake/engine");
    const derived = bareHex(computePartiesKey(EMPLOYER, WORKER));
    const sent = await sendOffer(input({ partiesKey: derived }));
    expect(sent.link.partiesKey).not.toBe(derived);
    await expect(sendOffer(input({ partiesKey: "abc" }))).rejects.toThrow(/64 hex/);
  });
});
