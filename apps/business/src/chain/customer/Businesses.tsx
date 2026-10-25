"use client";

// ---------------------------------------------------------------------------
// A customer's businesses (books/connections.ts, chain/clients.ts): businesses
// that asked to connect, finding one by its registered name to connect with,
// and who's connected. Connecting sends a hello, one Shield approval; once
// both hellos are in, messages (and next, invoices and payments) go sealed
// between the two. Nothing here logs an account or a letter.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useCustomer } from "@/books/BooksProvider";
import { type Connections, connectedIn, connectionState, ignoreConnection, keepMine, noteHelloReceived, noteHelloSent, requestsIn } from "@/books/connections";
import { BRAND } from "@/brand";
import type { DirectoryEntry } from "../directory";
import { newHalf } from "../key_ring";
import NameLookup from "../NameLookup";
import { ShieldNeeded } from "../clients/ShieldNeeded";
import { type CheckedHello, useHellos } from "../clients/useHellos";


export default function Businesses() {
  return (
    <AleoWalletProviderWrapper>
      <List />
    </AleoWalletProviderWrapper>
  );
}

/** Hellos from businesses, recorded. */
export function recordBusinessHellos(conns: Connections, found: readonly CheckedHello[], now: string): Connections {
  let next = conns;
  for (const f of found) next = noteHelloReceived(next, f.address, { v: 1, type: "hello", side: "business", name: f.name, nameHash: f.nameHash, publicKey: f.publicKey }, now);
  return next;
}

type Who = { address: string; name: string; nameHash: string };

function List() {
  const { customer, rail, updateCustomer } = useCustomer();
  const shield = useHellos("customer", customer.name ?? null);
  const { letters, check, sayHello } = shield;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<DirectoryEntry | null>(null);
  const [checked, setChecked] = useState(false);
  const started = useRef(false);
  const conns = customer.businesses;

  async function look() {
    setBusy("check");
    setError(null);
    try {
      const hellos = await check();
      const now = new Date().toISOString();
      await updateCustomer((c) => {
        const next = recordBusinessHellos(c.businesses ?? {}, hellos, now);
        return Object.keys(next).length > 0 ? { ...c, businesses: next } : c;
      });
      setChecked(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

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
      const mine = conns?.[who.address]?.mine ?? (await newHalf());
      await updateCustomer((c) => ({ ...c, businesses: keepMine(c.businesses ?? {}, who, mine) }));
      await sayHello(who.address, mine);
      const now = new Date().toISOString();
      await updateCustomer((c) => ({ ...c, businesses: noteHelloSent(c.businesses ?? {}, who, mine, now) }));
      setFound(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function notNow(address: string) {
    setError(null);
    try {
      await updateCustomer((c) => ({ ...c, businesses: ignoreConnection(c.businesses ?? {}, address) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!rail) return null;
  const requests = requestsIn(conns);
  const connected = connectedIn(conns);
  const waiting = Object.values(conns ?? {}).filter((c) => connectionState(c) === "waiting");
  const ready = !!letters && !!customer.name;
  const foundState = found ? connectionState(conns?.[found.address]) : null;

  return (
    <div className="flex flex-col gap-4">
      {!letters && <ShieldNeeded {...shield} linked={rail.address} what="connect with businesses" />}
      {letters && (
        <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy !== null} onClick={() => void look()}>
          <RefreshCw aria-hidden className="size-4" />
          {busy === "check" ? "Checking…" : "Check for requests"}
        </Button>
      )}

      {requests.map((r) => (
        <div key={r.address} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-card p-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {r.name}.{BRAND.nameSuffix}
            </span>{" "}
            wants to connect with you, to message you and send you invoices.
          </p>
          <Button className="min-h-11 sm:min-h-9" disabled={!ready || busy !== null} onClick={() => void connect(r)}>
            {busy === r.address ? "Connecting…" : "Connect"}
          </Button>
          <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => void notNow(r.address)}>
            Not now
          </Button>
        </div>
      ))}

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Connect with a business</h2>
        <NameLookup allow={["business"]} label="Their registered name" hint={`Like cedar_co.${BRAND.nameSuffix}. Ask the business for it.`} onChange={setFound} disabled={busy !== null} />
        {found && (
          <div className="flex flex-wrap items-center gap-3">
            {foundState === "connected" ? (
              <p className="text-sm">You&apos;re already connected.</p>
            ) : !found.name ? (
              <p className="text-sm text-muted-foreground">That business&apos;s name can&apos;t be read from the registry right now. Try again later.</p>
            ) : (
              <Button className="min-h-11 sm:min-h-9" disabled={!ready || busy !== null} onClick={() => void connect({ address: found.address, name: found.name, nameHash: found.nameHash.replace(/field$/, "") })}>
                {busy === found.address ? "Connecting…" : foundState === "waiting" ? "Ask again" : `Connect with ${found.name}`}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Connecting is one approval in Shield. It tells only that business who you are; nothing about it is public.</p>
      </section>

      {connected.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {connected.map((c) => (
            <li key={c.address}>
              <Link href={`/customer/messages?with=${encodeURIComponent(c.address)}`} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {c.name}.{BRAND.nameSuffix}
                </span>
                <span className="text-xs underline underline-offset-4">Agreements and messages</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Waiting for {waiting.map((w) => `${w.name}.${BRAND.nameSuffix}`).join(", ")} to connect.
        </p>
      )}
      {checked && requests.length === 0 && connected.length === 0 && waiting.length === 0 && (
        <p className="text-sm text-muted-foreground">No businesses yet. Find one by its registered name above, or give a business yours.</p>
      )}
      <FormError message={error} />
    </div>
  );
}
