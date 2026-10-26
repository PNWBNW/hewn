// ---------------------------------------------------------------------------
// The business's view key (Joshua, 2026-10-26): what lets the books read every
// private payment into the Shield account, each on its own, straight from the
// network's copy of it. Shield shows a business its payments but won't open them
// for the app, and joins each new one with what's already there within a
// minute, so without the key a payment from someone the business isn't
// connected with can't be read.
//
// A view key can read the account's history and nothing else: it can't spend
// or sign. It is entered once (in setup, or later in Settings), checked
// against the linked account before it's kept (chain/ViewKeyPanel.tsx), and
// kept only inside the encrypted books on this device: never sent, never
// logged, never in the backup kept as letters (books/books_backup.ts). A
// backup file holds it under the same encryption as the device does.
//
// A business may skip it; setup says what the books lose, and Settings takes
// it later. Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import type { Company } from "./company";
import type { Rail } from "./rail";

/** Whether the business entered its view key or chose to go without, in setup or Settings. Backed up, so a restore doesn't ask again. */
export type ViewKeyChoice = "added" | "skipped";

/** Accounts linked from now on are asked in setup; older ones add it from Settings. */
export const VIEW_KEY_SINCE = "2026-10-26T16:30:00.000Z";

const VIEW_KEY = /^AViewKey1[1-9A-HJ-NP-Za-km-z]{40,60}$/;

/** A view key as typed or pasted: trimmed; throws when it can't be one. Whether it belongs to the account is the network side's check. */
export function cleanViewKey(text: string): string {
  const key = text.trim();
  if (!VIEW_KEY.test(key)) throw new Error("That isn't a view key. It starts with AViewKey1; copy it from Shield's settings.");
  return key;
}

/** Keeps a view key already checked against the linked account. */
export function setViewKey(company: Company, key: string): Company {
  return { ...company, viewKey: cleanViewKey(key), viewKeyChoice: "added" };
}

/** Goes on without one, for now: the books can't read private payments from people the business isn't connected with. */
export function skipViewKey(company: Company): Company {
  const { viewKey: _gone, ...rest } = company;
  return { ...rest, viewKeyChoice: "skipped" };
}

/** Forgets the key; the choice stays "skipped" so setup doesn't ask again. */
export const forgetViewKey = skipViewKey;

/** Whether setup asks for it: a business linked since the step existed, that hasn't chosen yet. */
export function viewKeyStepApplies(rail: Pick<Rail, "linkedAt"> | null | undefined): boolean {
  return !rail || Date.parse(rail.linkedAt) >= Date.parse(VIEW_KEY_SINCE);
}
