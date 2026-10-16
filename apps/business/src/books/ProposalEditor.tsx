"use client";

// ---------------------------------------------------------------------------
// Editing an offer's terms: the person asking for changes and the business
// countering back fill in the same form. Pay, how often, employment type,
// hours and start date are fields of their own (so a counter-offer names
// exactly what changes); the written terms and the offer letter are text.
// Changing a field also changes it in the written terms, wherever the text
// still says the old one.
// ---------------------------------------------------------------------------

import { PAY_FREQUENCIES } from "@pnw/payroll";
import { Field, inputClass } from "./AuthCard";
import { LETTER_LABEL, MAX_SECTION_CHARS, letterFromText, letterText } from "./offer_letter";
import { EMPLOYMENT_TYPES, type EmploymentType } from "./terms_words";
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
      <div className="grid gap-3 sm:grid-cols-3">
        <JobBoxes
          employmentType={value.employmentType}
          hoursText={value.hoursText}
          onEmploymentType={(employmentType) => setStructured({ employmentType })}
          onHours={(hoursText) => setStructured({ hoursText })}
        />
        <Field label="Start date">
          <input type="date" className={inputClass} value={value.startDate} onChange={(e) => setStructured({ startDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Written terms">
        <textarea className={textareaClass} rows={6} value={value.termsText} onChange={(e) => onChange({ ...value, termsText: e.target.value })} />
      </Field>
      <Field label={LETTER_LABEL}>
        <textarea
          className={textareaClass}
          rows={8}
          maxLength={MAX_SECTION_CHARS}
          value={letterText(value.letter)}
          onChange={(e) => onChange({ ...value, letter: letterFromText(e.target.value) })}
        />
      </Field>
    </div>
  );
}

/** The employment type and hours boxes, the same in an offer and in a counter-offer. */
export function JobBoxes(props: {
  employmentType: EmploymentType | "";
  hoursText: string;
  onEmploymentType: (t: EmploymentType | "") => void;
  onHours: (text: string) => void;
}) {
  return (
    <>
      <Field label="Employment">
        <select className={inputClass} value={props.employmentType} onChange={(e) => props.onEmploymentType(e.target.value as EmploymentType | "")}>
          <option value="">Not stated</option>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hours a week">
        <input className={inputClass} inputMode="decimal" placeholder="40" value={props.hoursText} onChange={(e) => props.onHours(e.target.value)} />
      </Field>
    </>
  );
}
