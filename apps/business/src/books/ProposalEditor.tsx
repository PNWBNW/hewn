"use client";

// ---------------------------------------------------------------------------
// Editing an offer's terms: the person asking for changes and the business
// countering back fill in the same form. Pay, frequency and start date are
// fields; the written terms and the letter's sections are text. Changing the
// pay or the start date also changes them in the written terms, wherever the
// text still says the old ones.
// ---------------------------------------------------------------------------

import { PAY_FREQUENCIES } from "@pnw/payroll";
import { Field, inputClass } from "./AuthCard";
import { LETTER_SECTIONS } from "./offer_letter";
import { type Proposal, type ProposalDraft, proposalFromDraft, syncTermsText } from "./thread";

export { type ProposalDraft, draftOf, proposalFromDraft } from "./thread";

const textareaClass = `${inputClass} h-auto min-h-24 py-2`;

export function ProposalEditor({ value, onChange }: { value: ProposalDraft; onChange: (next: ProposalDraft) => void }) {
  /** Applies a change to pay or start, carrying it into the written terms too. */
  function setStructured(patch: Partial<ProposalDraft>) {
    const next = { ...value, ...patch };
    const before = proposalFromDraft(value);
    const after = proposalFromDraft(next);
    if ("proposal" in before && "proposal" in after) next.termsText = syncTermsText(value.termsText, before.proposal, after.proposal);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Paid by">
          <select className={inputClass} value={value.payType} onChange={(e) => setStructured({ payType: e.target.value as Proposal["payType"] })}>
            <option value="hourly">The hour</option>
            <option value="salary">The year (salary)</option>
          </select>
        </Field>
        <Field label={value.payType === "hourly" ? "Pay an hour ($)" : "Pay a year ($)"}>
          <input className={inputClass} inputMode="decimal" value={value.rateText} onChange={(e) => setStructured({ rateText: e.target.value })} />
        </Field>
        <Field label="Paid">
          <select className={inputClass} value={value.frequency} onChange={(e) => setStructured({ frequency: e.target.value as Proposal["frequency"] })}>
            {PAY_FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Start date">
        <input type="date" className={inputClass} value={value.startDate} onChange={(e) => setStructured({ startDate: e.target.value })} />
      </Field>
      <Field label="Written terms">
        <textarea className={textareaClass} rows={6} value={value.termsText} onChange={(e) => onChange({ ...value, termsText: e.target.value })} />
      </Field>
      <details className="rounded-md border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium sm:min-h-0">Offer letter sections</summary>
        <div className="mt-3 flex flex-col gap-3">
          {LETTER_SECTIONS.map((s) => (
            <Field key={s.key} label={s.label} hint={s.hint}>
              <textarea
                className={textareaClass}
                rows={4}
                value={value.letter[s.key]}
                onChange={(e) => onChange({ ...value, letter: { ...value.letter, [s.key]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}
