// ---------------------------------------------------------------------------
// Offers and agreements against a real Aleo node (docs/VEIL.md, step 1): the
// program Hewn offers through, employer_agreement_v5, deployed from its live
// bytecode and driven by Hewn's own code. The employer builds the offer with
// `createOfferInputsV5`; the worker finds it with `parseAgreementRecords` and
// accepts with `acceptCall`; the employer reads the worker's half back with
// `finalAgreements` and withdraws with the record `sentOfferPlaintext` finds.
// What the unit tests can only assume (the struct and packed-word encodings,
// the record layouts the parsers read, who may sign what) is checked here
// against the Aleo VM. Test-only keys (harness.ts).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinalizeRevertError } from "@provablehq/veil-core";
import { computeAgreementValues } from "@pnw/handshake/engine";
import { AGREEMENT_V5 } from "@/chain/agreement_programs";
import { newHalf } from "@/chain/key_ring";
import { FREQUENCY_CODES, OFFER_FUNCTION_V5, WITHDRAW_FUNCTION_V5, createOfferInputsV5, finalAgreements, newPartiesKey, sentOfferPlaintext } from "@/chain/offer";
import { acceptCall, parseAgreementRecords } from "@/chain/work/agreements";
import { type Aleo, type Clients, type Devnode, deploy, fundedAccount, opened, send, start } from "./harness";

/** The live program's bytecode, as read from the explorer on 2026-11-06 and 11-07. */
const PROGRAM_SHA256 = "a81fec03bb1418ef4020a3433d22107d1c34aa50e1d6ca76bbf8eab905a6ed19";

const CREATE_OUTPUTS = ["PendingAgreement", "SentOffer"] as const;
const ACCEPT_OUTPUTS = ["FinalAgreement", "FinalAgreement"] as const;

let node: Devnode;
let employer: Clients;
let aleo: Aleo;

beforeAll(async () => {
  ({ node, clients: employer, aleo } = await start());
  await deploy(employer, "employer_agreement_v5.aleo", PROGRAM_SHA256);
});

afterAll(async () => {
  await node?.stop();
});

const TERMS = '{"version":1,"kind":"terms","role":"Crew lead"}';
let clock = 1_762_473_600;

/**
 * An offer from the node's account to `worker`, built the way the app builds one. Each offer
 * gets its own second, as the app's do: the agreement id hashes the employer, the terms and the
 * offer time, not the worker.
 */
async function offerTo(worker: string, opts: { partiesKey?: string; offerTime?: number } = {}) {
  const half = await newHalf();
  const offerTime = opts.offerTime ?? (clock += 1);
  const computed = { ...computeAgreementValues(employer.account.address, worker, TERMS, offerTime), parties_key: `0x${opts.partiesKey ?? newPartiesKey()}` };
  const inputs = createOfferInputsV5(
    { computed, employerNameHash: "1234567field", workerNameHash: "7654321field", workerAddress: worker, industryCode: 9, frequencyCode: FREQUENCY_CODES.biweekly, epochs: { start: 100, end: 0, review: 200 } },
    half.publicKey,
  );
  const outputs = await send(employer, { program: AGREEMENT_V5, function: OFFER_FUNCTION_V5, inputs });
  return { half, computed, outputs, agreementId: computed.agreement_id.replace(/^0x/, "") };
}

describe("offers and agreements on a real Aleo node", () => {
  it("delivers an offer the worker reads with Hewn's parser, and keeps the employer's copy", async () => {
    const { account: worker } = await fundedAccount(aleo, employer);
    const offer = await offerTo(worker.address);

    const pending = parseAgreementRecords(opened(aleo, offer.outputs, worker.viewKey, CREATE_OUTPUTS), worker.address, AGREEMENT_V5);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "pending",
      agreementId: offer.agreementId,
      partiesKey: offer.computed.parties_key.replace(/^0x/, ""),
      employerAddress: employer.account.address,
      workerAddress: worker.address,
      employerHalf: offer.half.publicKey,
      termsDocHash: offer.computed.terms_doc_hash.replace(/^0x/, ""),
    });

    // The employer's SentOffer: what withdrawing takes, found the way the app finds it.
    const mine = opened(aleo, offer.outputs, employer.account.viewKey, CREATE_OUTPUTS);
    expect(mine.map((r) => r.recordName)).toEqual(["SentOffer"]);
    expect(sentOfferPlaintext(mine, offer.agreementId)).toBe(mine[0]!.recordPlaintext);
  });

  it("is accepted by the worker, and each side's copy carries the other's half", async () => {
    const { account: worker, clients: workerClient } = await fundedAccount(aleo, employer);
    const offer = await offerTo(worker.address);
    const [pending] = parseAgreementRecords(opened(aleo, offer.outputs, worker.viewKey, CREATE_OUTPUTS), worker.address, AGREEMENT_V5);
    const workerHalf = await newHalf();

    const outputs = await send(workerClient, acceptCall(pending!, 1_762_477_200, workerHalf.publicKey));

    // The worker's copy, final, with both halves: the pair's key can now be made on both sides.
    const finals = parseAgreementRecords(opened(aleo, outputs, worker.viewKey, ACCEPT_OUTPUTS), worker.address, AGREEMENT_V5);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ kind: "final", agreementId: offer.agreementId, employerHalf: offer.half.publicKey, workerHalf: workerHalf.publicKey });

    // The employer's copy, read the way the import reads it.
    const theirs = finalAgreements(opened(aleo, outputs, employer.account.viewKey, ACCEPT_OUTPUTS));
    expect(theirs.get(offer.agreementId)).toEqual({ workerHalf: workerHalf.publicKey });
  });

  it("can be withdrawn with the employer's SentOffer, and then can't be accepted", async () => {
    const { account: worker, clients: workerClient } = await fundedAccount(aleo, employer);
    const offer = await offerTo(worker.address);
    const sent = sentOfferPlaintext(opened(aleo, offer.outputs, employer.account.viewKey, CREATE_OUTPUTS), offer.agreementId);
    await send(employer, { program: AGREEMENT_V5, function: WITHDRAW_FUNCTION_V5, inputs: [sent!] });

    const [pending] = parseAgreementRecords(opened(aleo, offer.outputs, worker.viewKey, CREATE_OUTPUTS), worker.address, AGREEMENT_V5);
    await expect(send(workerClient, acceptCall(pending!, 1_762_477_200, (await newHalf()).publicKey))).rejects.toBeInstanceOf(FinalizeRevertError);
  });

  it("refuses an acceptance signed by anyone but the worker", async () => {
    const { account: worker } = await fundedAccount(aleo, employer);
    const { clients: stranger } = await fundedAccount(aleo, employer);
    const offer = await offerTo(worker.address);
    const [pending] = parseAgreementRecords(opened(aleo, offer.outputs, worker.viewKey, CREATE_OUTPUTS), worker.address, AGREEMENT_V5);
    await expect(send(stranger, acceptCall(pending!, 1_762_477_200, (await newHalf()).publicKey))).rejects.toThrow();
  });

  it("refuses a second offer with the same parties key, and an offer to oneself", async () => {
    const { account: worker } = await fundedAccount(aleo, employer);
    const partiesKey = newPartiesKey();
    await offerTo(worker.address, { partiesKey });
    await expect(offerTo(worker.address, { partiesKey })).rejects.toBeInstanceOf(FinalizeRevertError);
    await expect(offerTo(employer.account.address)).rejects.toThrow();
  });

  it("refuses the same terms at the same second to someone else: one agreement id, one offer", async () => {
    const [{ account: first }, { account: second }] = [await fundedAccount(aleo, employer), await fundedAccount(aleo, employer)];
    const offerTime = (clock += 1);
    await offerTo(first.address, { offerTime });
    await expect(offerTo(second.address, { offerTime })).rejects.toBeInstanceOf(FinalizeRevertError);
  });
});
