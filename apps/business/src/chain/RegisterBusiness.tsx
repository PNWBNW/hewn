"use client";

// ---------------------------------------------------------------------------
// Registering the business's name on the registry: the name other people
// find it by (acme.hewn), which every offer, and later every payment between
// businesses, carries. Loaded through a dynamic import, so nobody without the
// rail downloads it.
//
//   1. Read the registry for this account: a name already held is kept; a
//      worker's account can't take one.
//   2. Pick a name and an industry, check it is free.
//   3. `register_employer_free` in Shield: free, only the network fee. Done
//      only when Shield reports it accepted.
//
// No address, key or document is logged from here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { queryNamePlaintext } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { type Rail, shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import type { Company } from "@/books/company";
import { ShieldStatus } from "./ShieldStatus";
import { type AccountStatus, INDUSTRIES, NAME_RULE, REGISTER_BUSINESS, accountStatus, checkName, registerBusinessInputs } from "./business_registry";
import { executeAndWait } from "./work/execute";
import { useShield } from "./shield";

export type RegisterBusinessProps = { onClose: () => void; onDone?: () => void };

export default function RegisterBusiness(props: RegisterBusinessProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <RegisterFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

const FEE_NOTE = "Registering is free. Shield asks you to approve it, and the network fee is a little ALEO.";
const FAIL_HINT = "If it keeps failing: the account needs a little ALEO for the network fee, and the name must still be free.";

function railOf(c: Company): Rail {
  if (!c.rail) throw new Error("Link Shield in Settings first");
  return c.rail;
}

/** The flow itself, for use inside a wallet provider (the offer panel already has one). */
export function RegisterFlow({ onClose, onDone }: RegisterBusinessProps) {
  const { rail, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, wallet } = useShield();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(0);
  const [available, setAvailable] = useState<"idle" | "checking" | "free" | "taken">("idle");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readFor = useRef<string | null>(null);
  const keeping = useRef(false);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  const valid = /^[a-z0-9_]{3,16}$/.test(name) && industry > 0;

  const read = useCallback(async (account: string) => {
    setError(null);
    setStatus(null);
    try {
      setStatus(await accountStatus(account));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  // Once per connected account: where does the registry say it stands?
  useEffect(() => {
    if (!address || mismatch || readFor.current === address) return;
    readFor.current = address;
    void read(address);
  }, [address, mismatch, read]);

  /** Keeps the name in the books once it is certain to be on the registry. */
  const save = useCallback(
    async (nameHash: string, plain: string) => {
      await updateCompany((c) => ({ ...c, rail: { ...railOf(c), businessNameHash: nameHash, businessName: plain } }));
      setDone(plain);
      onDone?.();
    },
    [updateCompany, onDone],
  );

  // An account that already holds a business name just keeps it.
  useEffect(() => {
    if (status?.kind !== "has-name" || done !== null || keeping.current) return;
    keeping.current = true;
    const hash = status.nameHash;
    void (async () => {
      try {
        const plain = (await queryNamePlaintext(hash)) || "";
        await save(hash, plain);
      } catch (e) {
        keeping.current = false;
        setError(errorMessage(e));
      }
    })();
  }, [status, done, save]);

  async function check() {
    setError(null);
    setAvailable("checking");
    try {
      setAvailable((await checkName(name)).kind === "available" ? "free" : "taken");
    } catch (e) {
      setError(errorMessage(e));
      setAvailable("idle");
    }
  }

  async function register() {
    if (available !== "free") return;
    setBusy(true);
    setError(null);
    setFailed(false);
    try {
      const { nameHash, inputs } = registerBusinessInputs(name, industry);
      await executeAndWait(wallet, { ...REGISTER_BUSINESS, inputs });
      await save(nameHash, name);
    } catch (e) {
      setError(errorMessage(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const close = (
    <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
      {done !== null ? "Done" : "Close"}
    </Button>
  );

  if (!rail) {
    return (
      <>
        <FormError message="Link Shield in Settings first" />
        {close}
      </>
    );
  }

  if (done !== null) {
    return (
      <>
        <p className="text-sm">
          Your business is registered as <span className="font-medium">{done ? `${done}.${BRAND.nameSuffix}` : "its registered name"}</span>. Offers,
          and payments between businesses, carry it.
        </p>
        {close}
      </>
    );
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Register your business name</h3>
        <p className="text-xs text-muted-foreground">
          The name people find you by, like acme.{BRAND.nameSuffix}. It is public, one per account, and can&apos;t be changed later.
        </p>
      </div>

      {!address ? (
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
      ) : mismatch ? (
        <>
          <p className="text-sm">
            Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}).
            Switch accounts in Shield, then try again.
          </p>
          {close}
        </>
      ) : status === null ? (
        <>
          <p className="text-sm text-muted-foreground">{error ? "Couldn't read the registry." : "Checking the registry…"}</p>
          {error && (
            <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => void read(address)}>
              Try again
            </Button>
          )}
        </>
      ) : status.kind === "has-name" ? (
        <p className="text-sm text-muted-foreground">This account already has a business name. Saving it…</p>
      ) : status.kind === "worker-name" ? (
        <>
          <p className="text-sm">
            This account already holds a worker&apos;s name, and an account holds only one name. A business needs its own Shield account: switch to
            it in Shield and link that one in Settings.
          </p>
          {close}
        </>
      ) : (
        <>
          <Field label="Business name" hint={NAME_RULE}>
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value.toLowerCase());
                  setAvailable("idle");
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={16}
                disabled={busy}
              />
              <span className="text-sm text-muted-foreground">.{BRAND.nameSuffix}</span>
            </div>
          </Field>
          <Field label="Industry" hint="Shown with your name on the registry.">
            <select className={inputClass} value={industry} onChange={(e) => setIndustry(Number(e.target.value))} disabled={busy}>
              <option value={0}>Choose an industry</option>
              {INDUSTRIES.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>
          {available === "free" && (
            <p className="text-sm text-money-positive">
              {name}.{BRAND.nameSuffix} is available.
            </p>
          )}
          {available === "taken" && (
            <p className="text-sm text-destructive">
              {name}.{BRAND.nameSuffix} is taken. Try another.
            </p>
          )}
          <p className="text-xs text-muted-foreground">{FEE_NOTE}</p>
          <FormError message={error ?? shieldError} />
          {failed && <p className="text-xs text-muted-foreground">{FAIL_HINT}</p>}
          <div className="flex flex-wrap gap-3">
            {available === "free" ? (
              <Button className="min-h-11 sm:min-h-9" disabled={busy || !valid} onClick={() => void register()}>
                {busy ? "Registering…" : "Register name"}
              </Button>
            ) : (
              <Button className="min-h-11 sm:min-h-9" disabled={!valid || available === "checking"} onClick={() => void check()}>
                {available === "checking" ? "Checking…" : "Check availability"}
              </Button>
            )}
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {status === null && <FormError message={error ?? shieldError} />}
    </>
  );
}
