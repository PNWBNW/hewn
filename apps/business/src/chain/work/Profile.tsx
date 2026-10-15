"use client";

// ---------------------------------------------------------------------------
// The person's registered name and profile. Connect Shield; if the registry
// already has a name for this account, keep it; otherwise register one
// (availability first, then `register_worker_free`: free, only the network
// fee); then create the profile with the 15-input
// `create_worker_profile`. The profile is done only when Shield reports the
// transaction accepted: there is no skip. Nothing from the profile form is
// kept in the vault except the name hash, the name and the done flag, and
// nothing here is logged.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { INDUSTRY_SUFFIXES, computeNameHash, queryNameOwner, queryNamePlaintext, queryWorkerName } from "@pnw/records/registry/name_registry";
import { GENDER_LABELS } from "@pnw/records/registry/profile_types";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { setProfile } from "@/books/work";
import { BRAND } from "@/brand";
import { executeAndWait } from "./execute";
import { COUNTRY_CODES, US_STATE_CODES } from "./geo";
import { CITIZENSHIP, CREATE_PROFILE, GENDER_UNSPECIFIED, NAME_PATTERN, NAME_RULE, type ProfileForm, REGISTER, profileInputs, registerNameInputs } from "./registry";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type ProfilePanelProps = { onClose: () => void };

export default function ProfilePanel({ onClose }: ProfilePanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={onClose}>{(address) => <ProfileFlow address={address} onClose={onClose} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

const REGISTRY_FEE = "Registering is free; the network fee is a little ALEO.";

function ProfileFlow({ address, onClose }: { address: string; onClose: () => void }) {
  const { work, updateWork } = useWork();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Once per connection: does the registry already know this account?
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (!work.profile) {
          const hash = await queryWorkerName(address);
          if (hash) {
            const nameHash = hash.replace(/field$/, "").trim();
            const name = (await queryNamePlaintext(nameHash)) || "";
            await updateWork((w) => setProfile(w, { nameHash, name, profileAnchored: false, registeredAt: new Date().toISOString() }));
          }
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setChecked(true);
      }
    })();
  }, [address, work.profile, updateWork]);

  if (!checked) return <p className="text-sm text-muted-foreground">Checking the registry…</p>;
  if (!work.profile) return <RegisterName address={address} onClose={onClose} />;
  if (!work.profile.profileAnchored) return <CreateProfile address={address} onClose={onClose} />;
  return (
    <>
      <p className="text-sm">
        Registered as <span className="font-medium">{work.profile.name}.{BRAND.nameSuffix}</span>, profile created. Employers can send you offers.
      </p>
      <FormError message={error} />
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
        Done
      </Button>
    </>
  );
}

// ---- Register a name ------------------------------------------------------------------

type Availability = { kind: "idle" } | { kind: "checking" } | { kind: "available"; nameHash: string; yours: boolean } | { kind: "taken" };

function RegisterName({ address, onClose }: { address: string; onClose: () => void }) {
  const { updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<Availability>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = NAME_PATTERN.test(name);

  async function check() {
    setAvailability({ kind: "checking" });
    setError(null);
    try {
      const nameHash = computeNameHash(name);
      const owner = await queryNameOwner(nameHash);
      if (owner && owner !== address) setAvailability({ kind: "taken" });
      else setAvailability({ kind: "available", nameHash, yours: owner === address });
    } catch (e) {
      setError(errorMessage(e));
      setAvailability({ kind: "idle" });
    }
  }

  async function register() {
    if (availability.kind !== "available") return;
    setBusy(true);
    setError(null);
    try {
      const { nameHash, inputs } = registerNameInputs(name);
      if (!availability.yours) await executeAndWait(wallet, { ...REGISTER, inputs });
      await updateWork((w) => setProfile(w, { nameHash, name, profileAnchored: false, registeredAt: new Date().toISOString() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">Pick the name employers will know you by. It is public, one per account, and can&apos;t be changed later.</p>
      <Field label="Your name on the registry" hint={NAME_RULE}>
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase());
              setAvailability({ kind: "idle" });
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
      {availability.kind === "available" && (
        <p className="text-sm text-money-positive">
          {name}.{BRAND.nameSuffix} is {availability.yours ? "already yours" : "available"}.
        </p>
      )}
      {availability.kind === "taken" && <p className="text-sm text-destructive">{name}.{BRAND.nameSuffix} is taken. Try another.</p>}
      <p className="text-xs text-muted-foreground">{REGISTRY_FEE} Shield will ask you to approve it.</p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {availability.kind === "available" ? (
          <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void register()}>
            {busy ? "Registering…" : availability.yours ? "Use this name" : "Register name"}
          </Button>
        ) : (
          <Button className="min-h-11 sm:min-h-9" disabled={!valid || availability.kind === "checking"} onClick={() => void check()}>
            {availability.kind === "checking" ? "Checking…" : "Check availability"}
          </Button>
        )}
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

// ---- Create the profile ------------------------------------------------------------------

function CreateProfile({ address, onClose }: { address: string; onClose: () => void }) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [form, setForm] = useState<ProfileForm>({
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: GENDER_UNSPECIFIED,
    stateCode: 0,
    countryCode: 840,
    industryCode: 0,
    citizenshipFlag: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = work.profile!;
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const inputs = profileInputs(form, profile.nameHash, address, new Date());
      await executeAndWait(wallet, { ...CREATE_PROFILE, inputs });
      await updateWork((w) => setProfile(w, { ...profile, profileAnchored: true }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <p className="text-sm">
        Registered as <span className="font-medium">{profile.name}.{BRAND.nameSuffix}</span>. Now create your profile: it goes into a private record
        only you hold. Nothing on this form is kept on this device.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal first name">
          <input className={inputClass} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" maxLength={16} required />
        </Field>
        <Field label="Middle name" hint="Optional">
          <input className={inputClass} value={form.middleName} onChange={(e) => set("middleName", e.target.value)} autoComplete="additional-name" maxLength={16} />
        </Field>
        <Field label="Legal last name">
          <input className={inputClass} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" maxLength={16} required />
        </Field>
        <Field label="Date of birth">
          <input className={inputClass} type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} autoComplete="bday" required />
        </Field>
        <Field label="Gender" hint="Optional">
          <select className={inputClass} value={form.gender} onChange={(e) => set("gender", Number(e.target.value))}>
            {[3, 1, 2].map((code) => (
              <option key={code} value={code}>
                {GENDER_LABELS[code]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Country">
          <select className={inputClass} value={form.countryCode} onChange={(e) => set("countryCode", Number(e.target.value))}>
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="State">
          <select className={inputClass} value={form.stateCode} onChange={(e) => set("stateCode", Number(e.target.value))} required>
            <option value={0}>Choose a state</option>
            {US_STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <select className={inputClass} value={form.industryCode} onChange={(e) => set("industryCode", Number(e.target.value))} required>
            <option value={0}>Choose an industry</option>
            {Object.entries(INDUSTRY_SUFFIXES).map(([code, { label }]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Citizenship">
          <select className={inputClass} value={form.citizenshipFlag} onChange={(e) => set("citizenshipFlag", Number(e.target.value))}>
            {CITIZENSHIP.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Shield will ask you to approve it; the network fee is a little ALEO.</p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy}>
          {busy ? "Creating…" : "Create profile"}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Later
        </Button>
      </div>
    </form>
  );
}
