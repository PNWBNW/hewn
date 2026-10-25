// ---------------------------------------------------------------------------
// Books brought back from the backup kept with the account (docs/CHAIN_BACKUP.md,
// part 3). The finding and opening happen in src/chain; this is the shape they
// hand back and what the books do with it before the vault is written.
// ---------------------------------------------------------------------------

import {
  type KeySlots,
  type SealedAttachment,
  type VaultSession,
  type VaultStore,
  VaultError,
  openKeySlots,
  openKeySlotsWithRecovery,
  resetWithRecovery,
  unlockVault,
} from "@pnw/vault";
import { AccountError, ROLES, accountSecret, checkAccountPassphrase, normalizeUsername, vaultIdFor } from "./account";
import type { ChainState } from "./books_backup";
import { type Company, companyFromJson, companyToJson } from "./company";

/** What a found backup gives back: the books, how far they got, and the session they were opened with. */
export type FoundBooks = {
  company: Company;
  /** Pieces applied (the full copy is one). */
  applied: number;
  /** Pieces the backup had that could be read. */
  found: number;
  /** Set when a piece didn't fit: the books are as of the piece before. */
  stopped?: { at: number; reason: string };
  session: VaultSession;
  state: ChainState;
};

/** Opens a backup's key slots with what the person typed; throws the account's own message when it's wrong. */
export type OpenSlots = (slots: KeySlots) => Promise<VaultSession>;

/** Looks for this username's backup with the account and opens it with `openSlots`; null when there is none. */
export type FindBooks = (username: string, openSlots: OpenSlots) => Promise<FoundBooks | null>;

/** What opens the backup: the passphrase, or the recovery key with the new passphrase it sets. */
export type AccountUnlock = { passphrase: string } | { code: string; next: string };

/** How a restore went, for the screen to say. */
export type AccountRestoreReport = {
  applied: number;
  found: number;
  stopped?: { at: number; reason: string };
  /** Receipt and bill files the books refer to that aren't on this device (they travel only in backup files). */
  missingFiles: number;
};

/** Every file id the books refer to (bills, offers, a worker's files), wherever it sits in the document. */
export function fileIdsIn(company: Company): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "attachmentId" && typeof x === "string") ids.add(x);
        else walk(x);
      }
    }
  };
  walk(company);
  return ids;
}

/**
 * The books as the vault keeps them after a restore: recorded as backed up now, carrying on the
 * backup where it left off. A new passphrase (a recovery-key restore) wraps the key afresh, so the
 * next backup starts a new full copy rather than add to one the old passphrase opens.
 */
export function restoredCompany(found: Pick<FoundBooks, "company" | "state">, { newPassphrase, now = new Date().toISOString() }: { newPassphrase: boolean; now?: string }): Company {
  const { chainBackup: _, ...rest } = found.company;
  return newPassphrase ? { ...rest, backedUpAt: now } : { ...rest, backedUpAt: now, chainBackup: found.state };
}

/**
 * Finds the backup (`find`), opens it with what the person typed, and writes the books into this
 * device's vault under the same keys (a recovery-key restore sets the new passphrase first). Files
 * already on this device for these books stay; the report says how many the books miss. Returns
 * the open session for the caller to show, or null when there is no backup.
 */
export async function restoreIntoVault(
  store: VaultStore,
  find: FindBooks,
  rawUsername: string,
  unlock: AccountUnlock,
  now: string = new Date().toISOString(),
): Promise<{ report: AccountRestoreReport; session: VaultSession } | null> {
  const username = normalizeUsername(rawUsername);
  const recovering = "code" in unlock;
  if (recovering) checkAccountPassphrase(unlock.next, username); // a weak new passphrase is refused before anything is read
  const ids = await Promise.all(ROLES.map((role) => vaultIdFor(username, role)));
  const found = await find(username, async (slots) => {
    if (!ids.includes(slots.id)) throw new AccountError("This backup belongs to a different account");
    try {
      return recovering ? await openKeySlotsWithRecovery(slots, unlock.code) : await openKeySlots(slots, accountSecret(username, unlock.passphrase));
    } catch (e) {
      if (e instanceof VaultError && e.code === "WRONG_RECOVERY_KEY") throw new AccountError("That recovery key doesn't open this backup");
      if (e instanceof VaultError && e.code === "WRONG_PASSPHRASE") throw new AccountError("That username and passphrase don't open this backup");
      throw e;
    }
  });
  if (!found) return null;

  const company = restoredCompany(found, { newPassphrase: recovering, now });
  let session = found.session;
  await session.write(companyToJson(company), now);
  if (recovering) {
    const secret = accountSecret(username, unlock.next);
    const record = await resetWithRecovery(session.record, unlock.code, secret);
    session.lock();
    session = await unlockVault(record, secret);
  }
  companyFromJson(await session.read()); // the books written are intact

  const kept: SealedAttachment[] = [];
  for (const a of await store.listAttachments(session.id).catch((): SealedAttachment[] => [])) {
    if (await session.openAttachment(a).then(() => true, () => false)) kept.push(a);
  }
  const here = new Set(kept.map((a) => a.id));
  const missingFiles = [...fileIdsIn(company)].filter((id) => !here.has(id)).length;
  await store.replace(session.record, kept);
  return { report: { applied: found.applied, found: found.found, ...(found.stopped ? { stopped: found.stopped } : {}), missingFiles }, session };
}
