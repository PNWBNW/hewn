"use client";

// ---------------------------------------------------------------------------
// A business's customers on Hewn (books/connections.ts, chain/clients.ts): who
// asked to connect, who it can connect with (customers added by registered
// name), who it's waiting on, and who it's connected with. Connecting sends a
// hello, one Shield approval; once both hellos are in, messages (and next,
// invoices and payments) go sealed between the two. Shown on Sales →
// Customers. Nothing here logs an account or a letter.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Handshake, RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { addAskingCustomer, customerAt, linkKnownCustomers } from "@/books/clients";
import { type Connections, connectedIn, connectionState, ignoreConnection, keepMine, noteHelloReceived, noteHelloSent, requestsIn } from "@/books/connections";
import { registeredFor } from "@/books/rail";
import { BRAND } from "@/brand";
import { newHalf } from "../key_ring";
import { ShieldNeeded } from "./ShieldNeeded";
import { type CheckedHello, useHellos } from "./useHellos";

export default function BusinessClients() {
  return (
    <AleoWalletProviderWrapper>
      <Clients />
    </AleoWalletProviderWrapper>
  );
}

/** The hellos found, recorded: each customer's key, tied to the customer record when there is one. Ones turned down stay turned down. */
export function recordHellos(conns: Connections, found: readonly CheckedHello[], now: string): Connections {
  let next = conns;
  for (const f of found) {
    next = noteHelloReceived(next, f.address, { v: 1, type: "hello", side: "customer", name: f.name, nameHash: f.nameHash, publicKey: f.publicKey }, now);
  }
  return next;
}

type Who = { address: string; name: string; nameHash: string };

function Clients() {
  const { rail, sales, clients, updateCompany } = useOpenBooks();
  const me = rail?.businessName && rail.businessNameHash ? { name: rail.businessName, nameHash: rail.businessNameHash } : null;
  const shield = useHellos("business", me);
  const { letters, check, sayHello } = shield;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const started = useRef(false);

  async function look() {
    setBusy("check");
    setError(null);
    try {
      const found = await check();
      const now = new Date().toISOString();
      await updateCompany((c) => {
        const conns = linkKnownCustomers(c, recordHellos(c.clients ?? {}, found, now));
        return Object.keys(conns).length > 0 ? { ...c, clients: conns } : c;
      });
      setChecked(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Once Shield is connected, look for new requests.
  useEffect(() => {
    if (!letters || started.current) return;
    started.current = true;
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per connection
  }, [letters]);

  async function connect(who: Who) {
    setBusy(who.address);
    setError(null);
    try {
      const mine = clients?.[who.address]?.mine ?? (await newHalf());
      // The customer and my key are kept first, so their answer always finds a key to meet.
      await updateCompany((c) => {
        const withCustomer = customerAt(c, who.address) ? c : addAskingCustomer(c, who).company;
        return { ...withCustomer, clients: linkKnownCustomers(withCustomer, keepMine(withCustomer.clients ?? {}, who, mine)) };
      });
      await sayHello(who.address, mine);
      const now = new Date().toISOString();
      await updateCompany((c) => ({ ...c, clients: linkKnownCustomers(c, noteHelloSent(c.clients ?? {}, who, mine, now)) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function notNow(address: string) {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, clients: ignoreConnection(c.clients ?? {}, address) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!rail) return null;
  const requests = requestsIn(clients ?? undefined);
  const connected = connectedIn(clients ?? undefined);
  // Customers added by registered name that aren't connected yet.
  const reachable = sales.customers
    .filter((c) => c.active)
    .flatMap((c) => {
      const reg = registeredFor(rail, "customer", c.id);
      if (!reg) return [];
      const state = connectionState(clients?.[reg.address]);
      return state === "none" || state === "waiting" || state === "ignored" ? [{ id: c.id, label: c.name, state, who: { address: reg.address, name: reg.name, nameHash: reg.nameHash } }] : [];
    });
  const ready = !!letters && !!me;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Handshake aria-hidden className="size-4" />
        <h2 className="text-sm font-semibold">Customers on {BRAND.name}</h2>
        {ready && (
          <Button variant="ghost" size="sm" className="ml-auto min-h-11 sm:min-h-8" disabled={busy !== null} onClick={() => void look()}>
            <RefreshCw aria-hidden className="size-4" />
            {busy === "check" ? "Checking…" : "Check"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Connect with a customer who has a {BRAND.name} account to message them, and soon to send invoices they can pay from Shield. Connecting is one
        approval in Shield; nothing about it is public.
      </p>
      {!letters && <ShieldNeeded {...shield} linked={rail.address} what="connect with customers" />}
      {letters && !me && <p className="text-sm text-muted-foreground">Register your business name in Settings first.</p>}

      {requests.map((r) => (
        <div key={r.address} className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {r.name}.{BRAND.nameSuffix}
            </span>{" "}
            asked to connect{r.customerId ? "" : `; connecting adds them to your customers`}.
          </p>
          <Button className="min-h-11 sm:min-h-9" disabled={!ready || busy !== null} onClick={() => void connect(r)}>
            {busy === r.address ? "Connecting…" : "Connect"}
          </Button>
          <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => void notNow(r.address)}>
            Not now
          </Button>
        </div>
      ))}

      {reachable.length > 0 && (
        <ul className="divide-y rounded-md border">
          {reachable.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {r.label}{" "}
                <span className="text-xs text-muted-foreground">
                  {r.state === "waiting" ? "· waiting for them to connect" : `· ${r.who.name}.${BRAND.nameSuffix}`}
                </span>
              </span>
              <Button variant={r.state === "waiting" ? "ghost" : "outline"} size="sm" className="min-h-11 sm:min-h-8" disabled={!ready || busy !== null} onClick={() => void connect(r.who)}>
                {busy === r.who.address ? "Connecting…" : r.state === "waiting" ? "Send again" : "Connect"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {connected.length > 0 && (
        <p className="text-sm">
          Connected with {connected.map((c) => c.name).join(", ")}.{" "}
          <Link href="/messages" className="underline underline-offset-4">
            Messages
          </Link>
        </p>
      )}
      {checked && requests.length === 0 && reachable.length === 0 && connected.length === 0 && (
        <p className="text-sm text-muted-foreground">No customers on {BRAND.name} yet. Add one by their registered name, or give them yours.</p>
      )}
      <FormError message={error} />
    </section>
  );
}
