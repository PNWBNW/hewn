"use client";

// ---------------------------------------------------------------------------
// The one place in the app that talks to the chain: the Shield wallet and the
// explorer. Settings loads it through a dynamic import when the user taps
// Connect or Import, so the fiat path never ships this code. Two modes:
//
//   connect  pick Shield (the only adapter), connect, prove control of the
//            address with a signed domain-separated message, look up the
//            business's registered name, save the `rail` part of the company.
//   import   read the employer's agreement records from the wallet and link
//            each one to a team member, or add one. The link keeps the
//            agreement's parties key, which seals paystubs to that person;
//            a link made before that existed is imported again to get it.
//            An offer this app sent (OfferPanel) shows as "Offer sent" until
//            the worker's acceptance is in the wallet as a FinalAgreement,
//            at which point the link turns linked by itself.
//
// No transaction is ever sent from here, and no address or signature is ever
// logged. Everything saved goes through the vault like any other change.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import { addWorker } from "@pnw/payroll";
import { scanAgreementRecords } from "@pnw/records/agreement_reader";
import { queryEmployerName, queryNamePlaintext } from "@pnw/records/registry/name_registry";
import type { WorkerRecord } from "@pnw/records/types/worker";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { WorkerForm } from "@/app/payroll/WorkerForm";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import type { Company } from "@/books/company";
import { acceptOffers } from "@/books/hiring";
import { type Rail, type RailLink, addLink, setRegistered, shortAddress, validateRail } from "@/books/rail";
import { BRAND } from "@/brand";
import { ShieldStatus } from "./ShieldStatus";
import { assertKindFree } from "./account_kind";
import { AGREEMENT_PROGRAMS } from "./agreement_programs";
import { finalAgreements } from "./offer";
import { partiesKeysOf } from "./parties_key";
import { RegisterFlow } from "./RegisterBusiness";
import { useShield } from "./shield";

export type RailPanelProps = { mode: "connect" | "import" | "register"; onClose: () => void };

export default function RailPanel({ mode, onClose }: RailPanelProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        {mode === "connect" ? <ConnectFlow onClose={onClose} /> : mode === "import" ? <ImportFlow onClose={onClose} /> : <RegisterFlow onClose={onClose} />}
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
  const { books, vaultId, role, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, wallet } = useShield();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link(address: string) {
    setBusy(true);
    setError(null);
    try {
      if (!vaultId) throw new Error("Log in first");
      // One kind of account per Shield account: refuse before Shield is asked to sign anything.
      await assertKindFree(role, address);
      const linkedAt = new Date().toISOString();
      const message = `${BRAND.railLinkDomain}\n${vaultId}\n${address}\n${linkedAt}`;
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
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
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

/** The link for one agreement; the parties key comes from the same record, read separately. */
function toLink(workerId: string, r: WorkerRecord, partiesKey: string | undefined): RailLink {
  if (!partiesKey) throw new Error("Couldn't read this agreement's key from Shield. Try importing again.");
  return { workerId, address: r.worker_addr, nameHash: r.worker_name_hash, agreementId: r.agreement_id, partiesKey, status: "linked", linkedAt: new Date().toISOString() };
}

const REIMPORT_HINT = "Re-import to enable paystub delivery";

function ImportFlow({ onClose }: { onClose: () => void }) {
  const { rail, payroll, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, wallet } = useShield();
  const [rows, setRows] = useState<WorkerRecord[] | null>(null);
  const [keys, setKeys] = useState<Map<string, string>>(new Map()); // agreement id → parties key
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // agreement id with the add form open
  const started = useRef(false);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  useEffect(() => {
    if (!address || mismatch || started.current) return;
    started.current = true;
    // The records once more, raw: the parties key for each link, and which
    // offers this app sent have been accepted (a FinalAgreement with that id).
    Promise.all([scanAgreementRecords(wallet.requestRecords, address, AGREEMENT_PROGRAMS), ...AGREEMENT_PROGRAMS.map((p) => wallet.requestRecords(p, true))]).then(
      async ([found, ...raws]) => {
        const records = raws.flatMap((raw) => (Array.isArray(raw) ? raw : []));
        setKeys(partiesKeysOf(records));
        const accepted = finalAgreements(records);
        const finals = new Set(accepted.keys());
        // Accepted offers become linked; anyone an offer was hiring joins the team (books/hiring.ts).
        if (finals.size > 0) {
          const halves = new Map([...accepted].flatMap(([id, f]) => (f.workerHalf ? [[id, f.workerHalf] as const] : [])));
          await updateCompany((c) => acceptOffers(c, finals, new Date().toISOString(), halves));
        }
        setRows(found);
      },
      (e: unknown) => setError(errorMessage(e)),
    );
  }, [address, mismatch, wallet, updateCompany]);

  async function save(r: WorkerRecord, workerId: string) {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, rail: addLink(railOf(c), toLink(workerId, r, keys.get(r.agreement_id))) }));
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
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
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
                // An offer this app sent, still waiting for the worker (the record is their pending agreement).
                const offered = !!link && !!linkedName && link.status === "offered";
                // A link from before paystub delivery existed: pick the same person again to fill in the key.
                const needsKey = !!link && !!linkedName && !link.partiesKey;
                const choices = needsKey ? [...payroll.workers.filter((w) => w.id === link.workerId), ...unlinked] : unlinked;
                return (
                  <li key={r.agreement_id} className="flex flex-col gap-3 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {r.display_name ? `${r.display_name}.${BRAND.nameSuffix}` : shortAddress(r.worker_addr)}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">agreement {r.agreement_id.slice(0, 8)}…</div>
                        {needsKey && (
                          <div className="text-xs text-muted-foreground">
                            Linked to {linkedName} · {REIMPORT_HINT}
                          </div>
                        )}
                      </div>
                      {offered ? (
                        <span className="text-sm">Offer sent · {linkedName}</span>
                      ) : linkedName && !needsKey ? (
                        <span className="text-sm text-money-positive">Linked ✓ · {linkedName}</span>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            className={`${inputClass} sm:w-44`}
                            aria-label={needsKey ? "Re-import as a team member" : "Link to a team member"}
                            value=""
                            onChange={(e) => e.target.value && void save(r, e.target.value)}
                          >
                            <option value="">{needsKey ? "Re-import as…" : "Link to…"}</option>
                            {choices.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                          {!linkedName && (
                            <Button
                              variant="outline"
                              className="min-h-11 whitespace-nowrap sm:min-h-10"
                              onClick={() => setAdding(adding === r.agreement_id ? null : r.agreement_id)}
                            >
                              Add to team
                            </Button>
                          )}
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
                            let rail = addLink(railOf(c), toLink(added.worker.id, r, keys.get(r.agreement_id)));
                            // Who they are on the registry, for the team list and later offers.
                            const name = r.display_name?.toLowerCase();
                            const nameHash = r.worker_name_hash.replace(/field$/, "").trim();
                            if (name && /^[a-z0-9_]{1,16}$/.test(name) && /^\d+$/.test(nameHash)) {
                              rail = setRegistered(rail, "worker", added.worker.id, { address: r.worker_addr, nameHash, name });
                            }
                            return { ...c, payroll: added.payroll, rail };
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
