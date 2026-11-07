// ---------------------------------------------------------------------------
// What the devnode tests share (README.md): the node, the clients, sending a
// call and waiting for it, and opening the records a view key can read, the
// way Shield would list them. Test-only: every key here is the devnode's
// seeded one or generated in the test (check_signing_path keeps these
// packages out of the app).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { startDevnode } from "@provablehq/veil-aleo-devnode";
import { createDevnodeClient, loadNetwork } from "@provablehq/veil-aleo-sdk";
import { waitForConfirmation } from "@provablehq/veil-core";

export type Devnode = Awaited<ReturnType<typeof startDevnode>>;
export type Clients = ReturnType<typeof createDevnodeClient>;
export type Aleo = Awaited<ReturnType<typeof loadNetwork>>;
export type Output = { type: string; value: string };
export type Call = { program: string; function: string; inputs: string[] };
/** A record as Shield lists it: what Hewn's parsers read. */
export type Listed = { recordName: string; recordPlaintext: string; spent: false };

export const CONFIRM_MS = 120_000;

/** Starts a node and the clients for its seeded account. */
export async function start(): Promise<{ node: Devnode; clients: Clients; aleo: Aleo }> {
  const node = await startDevnode({});
  const clients = createDevnodeClient();
  const aleo = await loadNetwork("testnet");
  return { node, clients, aleo };
}

/** Deploys a program from `programs/`, after checking it is the bytecode read from the explorer. */
export async function deploy(clients: Clients, file: string, sha256: string): Promise<string> {
  const source = readFileSync(new URL(`./programs/${file}`, import.meta.url), "utf8");
  expect(createHash("sha256").update(source).digest("hex")).toBe(sha256);
  await waitForConfirmation(clients.publicClient, await clients.walletClient.deployContract({ program: source }), CONFIRM_MS);
  return source;
}

/** Sends one call from `from` and waits for it; returns the first transition's outputs. */
export async function send(from: Clients, call: Call): Promise<Output[]> {
  const txId = await from.walletClient.writeContract(call);
  const tx = (await waitForConfirmation(from.publicClient, txId, CONFIRM_MS)) as { execution?: { transitions?: { outputs?: Output[] }[] } };
  return tx.execution?.transitions?.[0]?.outputs ?? [];
}

/** The record outputs a view key opens, named by their place in the transition's outputs. */
export function opened(aleo: Aleo, outputs: Output[], viewKey: string, names: readonly string[]): Listed[] {
  const out: Listed[] = [];
  outputs
    .filter((o) => o.type === "record")
    .forEach((o, i) => {
      try {
        out.push({ recordName: names[i] ?? "", recordPlaintext: aleo.decryptRecord(viewKey, o.value), spent: false });
      } catch {
        // Not this key's record.
      }
    });
  return out;
}

/** A fresh account with public credits to pay its own fees, and a client that signs as it. */
export async function fundedAccount(aleo: Aleo, funder: Clients, microcredits = 50_000_000) {
  const account = aleo.generateAccount();
  await send(funder, { program: "credits.aleo", function: "transfer_public", inputs: [account.address, `${microcredits}u64`] });
  return { account, clients: createDevnodeClient({ privateKey: account.privateKey }) };
}
