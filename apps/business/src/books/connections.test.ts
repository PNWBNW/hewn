import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { addCustomer } from "@pnw/sales";
import { addAskingCustomer, customerAt, linkKnownCustomers } from "./clients";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import {
  type Hello,
  connectedIn,
  connectionState,
  ignoreConnection,
  keepMine,
  noteHelloReceived,
  noteHelloSent,
  requestsIn,
  updateConnectionThread,
  validateConnections,
  validateHello,
} from "./connections";
import type { Half } from "./key_ring";
import { setRegistered } from "./rail";
import { emptyThread } from "./thread";

const A = "aleo1" + "a".repeat(58);
const B = "aleo1" + "c".repeat(58);
const key = (c: string) => "04" + c.repeat(128);
const half = (c: string): Half => ({ publicKey: key(c), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
const hello = (c: string, over: Partial<Hello> = {}): Hello => ({ v: 1, type: "hello", side: "customer", name: "rowan", nameHash: "42", publicKey: key(c), ...over });
const T0 = "2026-10-26T10:00:00.000Z";
const T1 = "2026-10-26T11:00:00.000Z";
const who = { address: A, name: "rowan", nameHash: "42" };

describe("a connection between a business and a customer", () => {
  it("goes none → waiting → connected when I start, and none → asked → connected when they do", () => {
    expect(connectionState(undefined)).toBe("none");
    let mineFirst = keepMine({}, who, half("1"));
    expect(connectionState(mineFirst[A])).toBe("none"); // a key kept, no hello sent yet
    mineFirst = noteHelloSent(mineFirst, who, half("1"), T0);
    expect(connectionState(mineFirst[A])).toBe("waiting");
    mineFirst = noteHelloReceived(mineFirst, A, hello("2"), T1);
    expect(connectionState(mineFirst[A])).toBe("connected");

    let theirsFirst = noteHelloReceived({}, A, hello("2"), T0);
    expect(connectionState(theirsFirst[A])).toBe("asked");
    expect(requestsIn(theirsFirst).map((c) => c.address)).toEqual([A]);
    theirsFirst = noteHelloSent(theirsFirst, who, half("1"), T1);
    expect(connectedIn(theirsFirst).map((c) => c.address)).toEqual([A]);
    expect(requestsIn(theirsFirst)).toEqual([]);
  });

  it("keeps the key it first made, so a hello sent again carries the same one", () => {
    const once = noteHelloSent({}, who, half("1"), T0);
    const twice = noteHelloSent(once, who, half("9"), T1);
    expect(twice[A]!.mine!.publicKey).toBe(key("1"));
    expect(twice[A]!.helloAt).toBe(T1);
  });

  it("keeps a request turned down turned down, until I connect myself", () => {
    let c = ignoreConnection(noteHelloReceived({}, A, hello("2"), T0), A);
    expect(connectionState(c[A])).toBe("ignored");
    expect(noteHelloReceived(c, A, hello("2"), T1)).toBe(c); // the same hello again changes nothing
    expect(connectionState(noteHelloReceived(c, A, hello("3"), T1)[A])).toBe("ignored");
    c = noteHelloSent(c, who, half("1"), T1);
    expect(connectionState(c[A])).toBe("connected");
  });

  it("starts the conversation afresh when their key changes, since the old one can't be made again", () => {
    let c = noteHelloSent(noteHelloReceived({}, A, hello("2"), T0), who, half("1"), T0);
    c = updateConnectionThread(c, A, (t) => ({ ...t, nextIn: 3 }), emptyThread);
    expect(c[A]!.thread?.nextIn).toBe(3);
    const fresh = noteHelloReceived(c, A, hello("4"), T1);
    expect(fresh[A]!.theirs).toBe(key("4"));
    expect(fresh[A]!.thread).toBeUndefined();
  });

  it("refuses what isn't a hello or a connection", () => {
    expect(() => validateHello({ ...hello("2"), publicKey: "04xyz" })).toThrow(/public key/);
    expect(() => validateHello({ ...hello("2"), side: "worker" })).toThrow(/business or a customer/);
    expect(() => validateHello({ ...hello("2"), name: "Rowan Ash" })).toThrow(/registered name/);
    expect(() => validateConnections({ [B]: { address: A, name: "rowan", nameHash: "42" } })).toThrow(/wrong account/);
    expect(() => validateConnections({ [A]: { address: A, name: "rowan", nameHash: "42", theirs: "nope" } })).toThrow(/public key/);
  });
});

describe("a business's customers and their connections", () => {
  function business() {
    const c = emptyCompany(createBooks({ businessName: "Cedar Co", fiscalYearStartMonth: 1 }));
    return { ...c, rail: { version: 1 as const, network: "testnet" as const, address: B, linkedAt: T0, links: [] } };
  }

  it("adds a customer who asked first, under their registered name, and ties the connection to them", () => {
    let c: Company = { ...business(), clients: noteHelloReceived({}, A, hello("2"), T0) };
    const added = addAskingCustomer(c, who);
    c = added.company;
    expect(c.sales.customers.find((x) => x.id === added.customerId)?.name).toBe("rowan");
    expect(customerAt(c, A)).toBe(added.customerId);
    expect(c.clients![A]!.customerId).toBe(added.customerId);
    // Asking again finds the same customer, not a second one.
    expect(addAskingCustomer(c, who).customerId).toBe(added.customerId);
    expect(c.sales.customers).toHaveLength(1);
  });

  it("ties a hello to a customer the business added by name before", () => {
    const base = business();
    const sales = addCustomer(base.sales, { name: "Rowan Ash" });
    const c = { ...base, sales: sales.sales, rail: setRegistered(base.rail, "customer", sales.customer.id, { address: A, name: "rowan", nameHash: "42" }) };
    const conns = linkKnownCustomers(c, noteHelloReceived({}, A, hello("2"), T0));
    expect(conns[A]!.customerId).toBe(sales.customer.id);
  });

  it("keeps connections in the vault document", () => {
    const c = { ...business(), clients: noteHelloSent(noteHelloReceived({}, A, hello("2"), T0), who, half("1"), T1) };
    expect(companyFromJson(companyToJson(c)).clients).toEqual(c.clients);
  });
});
