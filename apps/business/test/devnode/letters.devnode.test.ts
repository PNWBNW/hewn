// ---------------------------------------------------------------------------
// Letters against a real Aleo node (docs/VEIL.md, step 1). A local devnode
// runs the program Hewn deploys on testnet, byte for byte (programs/), and
// these tests drive it with Hewn's own letter code: the call `letterCall` and
// `manyCalls` build, the record `parseLetterRecord` reads, the envelope the
// mailbox seals and opens. What the unit tests can only assume (that the
// field packing, the lookup halves and the padded parcel are what the
// program takes and returns) is checked here against the Aleo VM itself.
//
// The devnode skips proof verification, so transactions carry placeholder
// proofs and a run takes seconds. It signs with the devnode's seeded,
// test-only key: in the app, every transaction is signed in Shield (INV-11),
// and nothing outside tests may import these packages (check_signing_path).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { open, seal } from "@pnw/mailbox";
import { LETTERS_PROGRAM, LETTER_BYTES, letterCall, manyCalls, parseLetterRecord } from "@/chain/letters";
import { type Aleo, type Clients, type Devnode, type Output, deploy, opened as openedBy, send as sendFrom, start } from "./harness";

const PROGRAM_FILE = new URL("./programs/hewn_letters_v2.aleo", import.meta.url);
/** The live program's bytecode, as read from the explorer on 2026-11-06. */
const PROGRAM_SHA256 = "982e2d82a95b632fe049221b645e5ff334d44370588db807624b1e0ed64a785a";

let node: Devnode;
let clients: Clients;
let aleo: Aleo;

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const send = (call: Parameters<typeof sendFrom>[1]) => sendFrom(clients, call);
const opened = (outputs: Output[], viewKey: string, names: readonly string[]) => openedBy(aleo, outputs, viewKey, names);

beforeAll(async () => {
  ({ node, clients, aleo } = await start());
  await deploy(clients, "hewn_letters_v2.aleo", PROGRAM_SHA256);
});

afterAll(async () => {
  await node?.stop();
});

describe("letters on a real Aleo node", () => {
  it("is the program Hewn sends with", () => {
    expect(readFileSync(PROGRAM_FILE, "utf8")).toMatch(new RegExp(`^program ${LETTERS_PROGRAM.replace(".", "\\.")};`));
  });

  it("delivers a letter only its recipient opens, and the sender keeps a copy", async () => {
    const them = aleo.generateAccount();
    const stranger = aleo.generateAccount();
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await seal(key, "msg", 0, bytes("Your paystub for October is ready."));
    const outputs = await send(letterCall(them.address, sealed.lookup, sealed.envelope));

    const received = opened(outputs, them.viewKey, ["Letter", "SentLetter"]);
    expect(received).toHaveLength(1);
    const letter = parseLetterRecord(received[0]);
    expect(letter).toMatchObject({ kind: "letter", lookup: sealed.lookup });
    expect(text(await open(key, "msg", 0, letter!.envelope))).toBe("Your paystub for October is ready.");

    const copy = parseLetterRecord(opened(outputs, clients.account.viewKey, ["Letter", "SentLetter"])[0]);
    expect(copy).toMatchObject({ kind: "sent", lookup: sealed.lookup });
    expect(text(await open(key, "msg", 0, copy!.envelope))).toBe("Your paystub for October is ready.");

    // Nobody else can even open the record, let alone the envelope.
    expect(opened(outputs, stranger.viewKey, ["Letter", "SentLetter"])).toHaveLength(0);
  });

  it("carries a document too long for a letter as a page", async () => {
    const them = aleo.generateAccount();
    const key = crypto.getRandomValues(new Uint8Array(32));
    const terms = "An offer's full terms. ".repeat(80);
    const sealed = await seal(key, "terms", 0, bytes(terms));
    expect(sealed.envelope.length).toBeGreaterThan(LETTER_BYTES);
    const call = letterCall(them.address, sealed.lookup, sealed.envelope);
    expect(call.function).toBe("send_page");
    const outputs = await send(call);
    const page = parseLetterRecord(opened(outputs, them.viewKey, ["Page"])[0]);
    expect(page).toMatchObject({ kind: "page", lookup: sealed.lookup });
    expect(text(await open(key, "terms", 0, page!.envelope))).toBe(terms);
  });

  it("sends one announcement to several people in one call, padding with the sender", async () => {
    const team = [aleo.generateAccount(), aleo.generateAccount(), aleo.generateAccount()];
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await seal(key, "ann_0", 0, bytes("Team meeting moved to Thursday."));
    const calls = manyCalls(
      team.map((t) => t.address),
      clients.account.address,
      sealed.lookup,
      sealed.envelope,
    );
    expect(calls).toHaveLength(1);
    const outputs = await send(calls[0]!);
    const names = [...Array(8).fill("Letter"), "SentLetter"];
    for (const member of team) {
      const mine = opened(outputs, member.viewKey, names);
      expect(mine).toHaveLength(1);
      const letter = parseLetterRecord(mine[0]);
      expect(text(await open(key, "ann_0", 0, letter!.envelope))).toBe("Team meeting moved to Thursday.");
    }
    // The five empty places, and the sender's copy, come back to the sender.
    expect(opened(outputs, clients.account.viewKey, names)).toHaveLength(6);
  });

  it("refuses what the program refuses: an all-zero lookup", async () => {
    const them = aleo.generateAccount();
    const parcel = `[${Array.from({ length: 34 }, () => "1field").join(", ")}]`;
    await expect(
      clients.walletClient.writeContract({ program: LETTERS_PROGRAM, function: "send", inputs: [them.address, "[0u128, 0u128]", parcel] }),
    ).rejects.toThrow();
  });
});
