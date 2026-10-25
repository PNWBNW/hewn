"use client";

// ---------------------------------------------------------------------------
// Issuing a credential to a team member (docs/HEWN_ART.md, "A worker's land
// and its landmarks"), and the business's list of the ones it issued. The
// document goes to the person first as a sealed page under the agreement's
// key (one Shield approval), then `issue` runs (a second), and the record is
// read back from Shield for its commitment. The document and the nonce are
// kept in the vault as a draft from the first step, so a send that fails
// part way is finished the next time this opens. Credentials need an
// agreement on employer_agreement_v5: the program checks the pair there.
// Loaded through a dynamic import from the Team page. Nothing here logs a
// key, a lookup, a document or an error.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { MailboxError } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_KIND_LABEL,
  CREDENTIAL_STATUS_LABEL,
  type Credential,
  type CredentialDraft,
  type CredentialKind,
  MAX_CREDENTIAL_DETAILS,
  MAX_CREDENTIAL_TITLE,
  credentialSpan,
  validateCredentialDocument,
} from "@/books/credential";
import { dropRailDraft, linkFor, registeredFor, setRailCredential, setRailDraft } from "@/books/rail";
import { BRAND } from "@/brand";
import { carriesHalves } from "./agreement_programs";
import { blockTime } from "./cards";
import {
  ISSUE_CREDENTIAL,
  REVOKE_CREDENTIAL,
  awaitCredentialStatus,
  credentialFromDraft,
  findRecordByNonce,
  issueInputs,
  moveInputs,
  newNonce,
  queryCredentialAnchor,
  queryCredentialStatus,
  readCredentialRecords,
  scopeHash,
  sealCredentialDocument,
} from "./credentials";
import { LetterBox } from "./letters";
import { executeAndWait } from "./work/execute";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./work/WorkShield";

export type IssueCredentialProps = { workerId: string; onClose: () => void };

export default function IssueCredential(props: IssueCredentialProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={props.onClose}>{(address) => <Flow {...props} address={address} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

const STEPS = {
  letter: "Approve sending the credential's document in Shield (1 of 2)…",
  issuing: "Approve issuing the credential in Shield (2 of 2)…",
  reading: "Issued. Reading the record back from Shield…",
  revoking: "Approve revoking the credential in Shield…",
  finishing: "Finishing an earlier credential: reading its record from Shield…",
} as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function Flow({ workerId, address, onClose }: IssueCredentialProps & { address: string }) {
  const { rail, payroll, updateCompany } = useOpenBooks();
  const { wallet } = useWorkShield();
  const worker = payroll.workers.find((w) => w.id === workerId);
  const link = rail ? linkFor(rail, workerId) : undefined;
  const registered = rail ? registeredFor(rail, "worker", workerId) : undefined;
  const issued = (rail?.credentials ?? []).filter((c) => c.workerId === workerId);
  const drafts = (rail?.credentialDrafts ?? []).filter((d) => d.workerId === workerId);
  const [stage, setStage] = useState<keyof typeof STEPS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kind, setKind] = useState<CredentialKind>("employment");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [details, setDetails] = useState("");
  const [composing, setComposing] = useState(false);
  const refreshed = useRef(false);

  const who = registered ? `${registered.name}.${BRAND.nameSuffix}` : worker?.name ?? "this person";

  async function saveCredential(c: Credential) {
    await updateCompany((co) => (co.rail ? { ...co, rail: setRailCredential(co.rail, c) } : co));
  }

  /** The record for a draft, read back from Shield; the draft becomes a credential in the books. */
  async function finish(draft: CredentialDraft, attempts = 15): Promise<Credential | null> {
    for (let i = 0; i < attempts; i++) {
      const records = await readCredentialRecords(wallet.requestRecords, address).catch(() => []);
      const record = findRecordByNonce(records, draft.nonce);
      if (record) {
        const c = credentialFromDraft(draft, record);
        const issuedAt = (await queryCredentialAnchor(c.commitment).catch(() => null)) ?? undefined;
        const since = issuedAt !== undefined ? ((await blockTime(issuedAt)) ?? undefined) : undefined;
        const kept: Credential = { ...c, ...(issuedAt !== undefined ? { issuedAt } : {}), ...(since ? { since } : {}) };
        await updateCompany((co) => (co.rail ? { ...co, rail: dropRailDraft(setRailCredential(co.rail, kept), draft.nonce) } : co));
        return kept;
      }
      if (i + 1 < attempts) await sleep(4_000);
    }
    return null;
  }

  // On opening: statuses of offered ones (the person may have answered), and any draft left from an earlier send.
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    (async () => {
      for (const c of issued) {
        if (c.status !== "offered") continue;
        const status = await queryCredentialStatus(c.commitment).catch(() => null);
        if (status && status !== c.status) await saveCredential({ ...c, status });
      }
      if (drafts.length > 0) {
        setStage("finishing");
        for (const d of drafts) await finish(d, 3);
        setStage(null);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!worker) return <FormError message="This person is no longer in the team list." />;
  if (!link || link.status !== "linked" || !rail) {
    return (
      <>
        <p className="text-sm text-muted-foreground">Credentials go to people who accepted an offer. {who} hasn&apos;t yet.</p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }
  const onV5 = carriesHalves(link.program);
  const partiesKey = link.partiesKey;

  async function issue(draft: CredentialDraft) {
    setError(null);
    setNote(null);
    try {
      if (!partiesKey) throw new Error("This person's agreement is missing its key; re-import them in Settings");
      // 1) The document to the person, under the agreement's key. A slot already taken means an earlier attempt sent it.
      setStage("letter");
      const sealed = await sealCredentialDocument(partiesKey, draft.document);
      try {
        await new LetterBox({ wallet, to: link!.address }).put(sealed.lookup, sealed.envelope);
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
      // 2) The credential itself.
      setStage("issuing");
      await executeAndWait(wallet, { ...ISSUE_CREDENTIAL, inputs: issueInputs(partiesKey, link!.address, draft.kind, draft.scope, draft.nonce) });
      // 3) Its record, for the commitment.
      setStage("reading");
      const kept = await finish(draft);
      setStage(null);
      if (!kept) setNote("The network accepted it, but its record hasn't shown in Shield yet. Open this again in a minute to finish.");
      else setNote(`Issued to ${who}. It shows on their land once they accept it.`);
      setComposing(false);
    } catch (e) {
      setStage(null);
      setError(errorMessage(e));
    }
  }

  async function start() {
    setError(null);
    try {
      if (!partiesKey) throw new Error("This person's agreement is missing its key; re-import them in Settings");
      const document = validateCredentialDocument({ version: 1, kind, title: title.trim(), from, ...(to ? { to } : {}), ...(details.trim() ? { details: details.trim() } : {}) });
      const draft: CredentialDraft = { nonce: newNonce(), workerId, kind, document, scope: scopeHash(document), counterpart: link!.address, startedAt: new Date().toISOString() };
      await updateCompany((co) => (co.rail ? { ...co, rail: setRailDraft(co.rail, draft) } : co));
      setTitle("");
      setFrom("");
      setTo("");
      setDetails("");
      await issue(draft);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function revoke(c: Credential) {
    setError(null);
    setNote(null);
    try {
      setStage("revoking");
      const records = await readCredentialRecords(wallet.requestRecords, address);
      const record = records.find((r) => r.role === "issuer" && r.commitment === c.commitment);
      if (!record) throw new Error("This credential's record isn't in Shield; check the account, then try again");
      await executeAndWait(wallet, { ...REVOKE_CREDENTIAL, inputs: moveInputs(record) });
      await awaitCredentialStatus(c.commitment, { until: (s) => s === "revoked" });
      await saveCredential({ ...c, status: "revoked" });
      setStage(null);
      setNote("Revoked. On their land it stays as a ghost of what was.");
    } catch (e) {
      setStage(null);
      setError(errorMessage(e));
    }
  }

  async function discard(d: CredentialDraft) {
    await updateCompany((co) => (co.rail ? { ...co, rail: dropRailDraft(co.rail, d.nonce) } : co));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Credentials for {who}</p>
        <p className="text-xs text-muted-foreground">
          A credential is your word that they worked here, hold a skill or a clearance, or anything you want to vouch for. They see it in their app and choose to accept it;
          nothing about it is public.
        </p>
      </div>

      {issued.length > 0 && (
        <ul className="divide-y rounded-md border bg-card text-sm">
          {issued.map((c) => (
            <li key={c.commitment} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.document.title}</div>
                <div className="text-xs text-muted-foreground">
                  {CREDENTIAL_KIND_LABEL[c.kind]} · {credentialSpan(c.document)} · {CREDENTIAL_STATUS_LABEL[c.status]}
                </div>
              </div>
              {(c.status === "offered" || c.status === "active") && (
                <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-8" disabled={stage !== null} onClick={() => void revoke(c)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {drafts.length > 0 && stage !== "finishing" && (
        <ul className="divide-y rounded-md border border-dashed bg-card text-sm">
          {drafts.map((d) => (
            <li key={d.nonce} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.document.title}</div>
                <div className="text-xs text-muted-foreground">Started but not on the network yet.</div>
              </div>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={stage !== null} onClick={() => void issue(d)}>
                Send again
              </Button>
              <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-8" disabled={stage !== null} onClick={() => void discard(d)}>
                Discard
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!onV5 ? (
        <p className="text-sm text-muted-foreground">
          {who}&apos;s agreement was made on the older agreement program. Credentials check the agreement on the current one, so they need a new offer first.
        </p>
      ) : composing ? (
        <div className="flex flex-col gap-3">
          <Field label="Kind">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)} disabled={stage !== null}>
              {CREDENTIAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CREDENTIAL_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What it says" hint={`In a line, up to ${MAX_CREDENTIAL_TITLE} characters: "Carpenter", "OSHA 30", "Site access, level 2".`}>
            <input className={inputClass} value={title} maxLength={MAX_CREDENTIAL_TITLE} onChange={(e) => setTitle(e.target.value)} disabled={stage !== null} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={stage !== null} />
            </Field>
            <Field label="To" hint="Leave empty while it runs.">
              <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={stage !== null} />
            </Field>
          </div>
          <Field label="Details" hint={`Optional, up to ${MAX_CREDENTIAL_DETAILS} characters, in your words.`}>
            <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} value={details} maxLength={MAX_CREDENTIAL_DETAILS} onChange={(e) => setDetails(e.target.value)} disabled={stage !== null} />
          </Field>
          <p className="text-xs text-muted-foreground">Shield asks twice: to send the document to {who} as a sealed page, then to issue the credential. The network fee is a little ALEO each.</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 sm:min-h-9" disabled={stage !== null || !title.trim() || !from} onClick={() => void start()}>
              Issue
            </Button>
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => setComposing(true)}>
            Issue a credential
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={onClose}>
            Close
          </Button>
        </div>
      )}

      {stage && (
        <p className="text-sm text-muted-foreground" role="status">
          {STEPS[stage]}
        </p>
      )}
      {note && (
        <p className="text-sm" role="status">
          {note}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
