"use client";

// ---------------------------------------------------------------------------
// A customer's name (docs/CUSTOMERS.md, decision 17). A customer is personal
// money, so the Shield account may be the one the same person uses as a
// worker: when the registry already has a person's name for it, the customer
// account takes that name; otherwise it registers one the way a worker does,
// with no profile behind it. On chain a customer's name looks exactly like a
// worker's. Nothing here is logged.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { computeNameHash, queryNamePlaintext, queryWorkerName } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useCustomer } from "@/books/BooksProvider";
import { setCustomerName } from "@/books/customer";
import { BRAND } from "@/brand";
import { RegisterName } from "../work/Profile";
import { ShieldGate, WorkShieldProvider } from "../work/WorkShield";
import { assertKindFree } from "../account_kind";

export default function CustomerNamePanel({ onClose }: { onClose: () => void }) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={onClose}>{(address) => <NameFlow address={address} onClose={onClose} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

type Found = { kind: "checking" } | { kind: "none" } | { kind: "owned"; nameHash: string; name: string };

function NameFlow({ address, onClose }: { address: string; onClose: () => void }) {
  const { customer, updateCustomer } = useCustomer();
  const [found, setFound] = useState<Found>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const save = (nameHash: string, name: string) => updateCustomer((c) => setCustomerName(c, { name, nameHash, registeredAt: new Date().toISOString() }));

  // Once per connection: does this Shield account already have a person's name?
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await assertKindFree("customer", address); // a business's Shield account can't hold a customer
        const hash = await queryWorkerName(address);
        if (!hash) return setFound({ kind: "none" });
        const nameHash = hash.replace(/field$/, "").trim();
        setFound({ kind: "owned", nameHash, name: (await queryNamePlaintext(nameHash)) || "" });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [address]);

  if (customer.name) {
    return (
      <p className="text-sm">
        Registered as <span className="font-medium">{customer.name.name}.{BRAND.nameSuffix}</span>.
      </p>
    );
  }
  if (error) {
    return (
      <>
        <FormError message={error} />
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Back
        </Button>
      </>
    );
  }
  if (found.kind === "checking") return <p className="text-sm text-muted-foreground">Checking the registry…</p>;
  if (found.kind === "none") return <RegisterName address={address} role="customer" save={save} onClose={onClose} />;
  return <UseOwnedName owned={found} save={save} onClose={onClose} />;
}

/** The Shield account already has a name: use it, after confirming the name when the registry doesn't say it in plain text. */
function UseOwnedName({ owned, save, onClose }: { owned: { nameHash: string; name: string }; save: (nameHash: string, name: string) => Promise<unknown>; onClose: () => void }) {
  const [typed, setTyped] = useState(owned.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = owned.name !== "";

  async function use() {
    setError(null);
    const name = typed.trim().toLowerCase();
    if (computeNameHash(name) !== owned.nameHash) {
      setError("That isn't the name this Shield account holds. Check the spelling.");
      return;
    }
    setBusy(true);
    try {
      await save(owned.nameHash, name);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">
        {known ? (
          <>
            This Shield account already has a name: <span className="font-medium">{owned.name}.{BRAND.nameSuffix}</span>. Your customer account uses it
            too, so businesses find you by it. Nothing is sent and nothing is paid.
          </>
        ) : (
          "This Shield account already has a name. Type it to use it for your customer account too; nothing is sent and nothing is paid."
        )}
      </p>
      {!known && (
        <Field label="Your registered name">
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toLowerCase())}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
              disabled={busy}
            />
            <span className="text-sm text-muted-foreground">.{BRAND.nameSuffix}</span>
          </div>
        </Field>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || typed.trim() === ""} onClick={() => void use()}>
          {busy ? "Saving…" : "Use this name"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
