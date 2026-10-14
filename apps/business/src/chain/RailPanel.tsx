"use client";

// ---------------------------------------------------------------------------
// The one place in the app that talks to the chain: the Shield wallet and the
// explorer. Settings loads it through a dynamic import when the user taps
// Connect or Import, so the fiat path never ships this code. Two modes:
//
//   connect  pick Shield (the only adapter), connect, prove control of the
//            address with a signed domain-separated message, look up the
//            business's registered name, save the `rail` part of the company.
//   import   read the employer's FinalAgreement records from the wallet and
//            link each one to a team member, or add one.
//
// No transaction is ever sent from here, and no address or signature is ever
// logged. Everything saved goes through the vault like any other change.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ENV } from "@pnw/config/env";
import { addWorker } from "@pnw/payroll";
import { scanAgreementRecords } from "@pnw/records/agreement_reader";
import { queryEmployerName, queryNamePlaintext } from "@pnw/records/registry/name_registry";
import type { WorkerRecord } from "@pnw/records/types/worker";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { WorkerForm } from "@/app/payroll/WorkerForm";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { VAULT_ID, useOpenBooks } from "@/books/BooksProvider";
import type { Company } from "@/books/company";
import { type Rail, type RailLink, addLink, shortAddress, validateRail } from "@/books/rail";
import { BRAND } from "@/brand";
import { ShieldStatus } from "./ShieldStatus";
import { useShield } from "./shield";

export type RailPanelProps = { mode: "connect" | "import"; onClose: () => void };

export default function RailPanel({ mode, onClose }: RailPanelProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        {mode === "connect" ? <ConnectFlow onClose={onClose} /> : <ImportFlow onClose={onClose} />}
      </div>
    </AleoWalletProviderWrapper>
  );
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The registered employer name for an address, if it has one. Public data; a miss is not an error. */
async function lookupBusinessName(address: string): Promise<{ businessNameHash?: string; businessName?: string }> {
  try {
    const hash = await queryEmployerName(address);
    if (!hash) return {};
    const businessNameHash = hash.replace(/field$/, "").trim();
    const businessName = (await queryNamePlaintext(businessNameHash)) || undefined;
    return { businessNameHash, businessName };
  } catch {
    return {};
  }
}

// ---- Connect ---------------------------------------------------------------

function ConnectFlow({ onClose }: { onClose: () => void }) {
  const { books, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link(address: string) {
    setBusy(true);
    setError(null);
    try {
      const linkedAt = new Date().toISOString();
      const message = `${BRAND.railLinkDomain}\n${VAULT_ID}\n${address}\n${linkedAt}`;
      const signature = await wallet.signMessage(new TextEncoder().encode(message));
      if (!signature) throw new Error("Shield didn't sign the message");
      const rail: Rail = validateRail({
        version: 1,
        network: ENV.NETWORK,
        address,
        linkedAt,
        ...(await lookupBusinessName(address)),
        linkProof: { message, signature: toHex(signature) },
        links: [],
      });
      await updateCompany((c) => ({ ...c, rail }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      {state.kind === "connected" ? (
        <>
          <p className="text-sm">
            Link this account to <span className="font-medium">{books.settings.businessName}</span>?
          </p>
          <p className="font-mono text-xs sm:text-sm">{shortAddress(state.address)}</p>
          <p className="text-xs text-muted-foreground">
            Shield will ask you to sign a short message proving this is your account. Nothing is paid and nothing is sent.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void link(state.address)}>
              {busy ? "Signing…" : "Link account"}
            </Button>
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
      )}
      <FormError message={error ?? shieldError} />
    </>
  );
}

// ---- Import ----------------------------------------------------------------

function railOf(c: Company): Rail {
  if (!c.rail) throw new Error("Link Shield first");
  return c.rail;
}

const toLink = (workerId: string, r: WorkerRecord): RailLink => ({
  workerId,
  address: r.worker_addr,
  nameHash: r.worker_name_hash,
  agreementId: r.agreement_id,
});

function ImportFlow({ onClose }: { onClose: () => void }) {
  const { rail, payroll, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const [rows, setRows] = useState<WorkerRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // agreement id with the add form open
  const started = useRef(false);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  useEffect(() => {
    if (!address || mismatch || started.current) return;
    started.current = true;
    scanAgreementRecords(wallet.requestRecords, address).then(setRows, (e: unknown) => setError(errorMessage(e)));
  }, [address, mismatch, wallet.requestRecords]);

  async function save(r: WorkerRecord, workerId: string) {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, rail: addLink(railOf(c), toLink(workerId, r)) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!rail) return <FormError message="Link Shield first" />;

  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  const unlinked = payroll.workers.filter((w) => w.active && !rail.links.some((l) => l.workerId === w.id));

  return (
    <>
      {!address ? (
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
      ) : mismatch ? (
        <>
          <p className="text-sm">
            Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books (
            {shortAddress(rail.address)}). Switch accounts in Shield, then try again.
          </p>
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
            Close
          </Button>
        </>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">{error ? "Couldn't read your team." : "Reading your team agreements…"}</p>
      ) : (
        <>
          <p className="text-sm">
            {rows.length === 0
              ? "No team agreements in this account yet."
              : `${rows.length} ${rows.length === 1 ? "agreement" : "agreements"} found. Match each one to a team member, or add them.`}
          </p>
          {rows.length > 0 && (
            <ul className="divide-y rounded-md border bg-card">
              {rows.map((r) => {
                const link = rail.links.find((l) => l.agreementId === r.agreement_id || l.address === r.worker_addr);
                const linkedName = link ? names.get(link.workerId) : undefined;
                return (
                  <li key={r.agreement_id} className="flex flex-col gap-3 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {r.display_name ? `${r.display_name}.${BRAND.nameSuffix}` : shortAddress(r.worker_addr)}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">agreement {r.agreement_id.slice(0, 8)}…</div>
                      </div>
                      {linkedName ? (
                        <span className="text-sm text-money-positive">Linked ✓ · {linkedName}</span>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            className={`${inputClass} sm:w-44`}
                            aria-label="Link to a team member"
                            value=""
                            onChange={(e) => e.target.value && void save(r, e.target.value)}
                          >
                            <option value="">Link to…</option>
                            {unlinked.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="outline"
                            className="min-h-11 whitespace-nowrap sm:min-h-10"
                            onClick={() => setAdding(adding === r.agreement_id ? null : r.agreement_id)}
                          >
                            Add to team
                          </Button>
                        </div>
                      )}
                    </div>
                    {adding === r.agreement_id && !linkedName && (
                      <WorkerForm
                        initial={{ name: r.display_name ?? "" }}
                        onCancel={() => setAdding(null)}
                        onSave={async (input) => {
                          await updateCompany((c) => {
                            const added = addWorker(c.payroll, input);
                            return { ...c, payroll: added.payroll, rail: addLink(railOf(c), toLink(added.worker.id, r)) };
                          });
                          setAdding(null);
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
            Done
          </Button>
        </>
      )}
      <FormError message={error ?? shieldError} />
    </>
  );
}
