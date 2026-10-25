"use client";

// ---------------------------------------------------------------------------
// Holds the open books for the whole app.
//
// Lifecycle: loading → "new" (no books on this device yet) or "locked" (some
// are here) → "open". An account is a username plus a passphrase (see
// account.ts; accounts made before usernames use their email as it): the
// vault id is a hash of the username and the role, and the vault key is
// wrapped with the username and passphrase together. Every change goes through `update`, which runs a pure ledger
// operation, then seals the result and saves it to IndexedDB before the
// screen moves on. Plaintext exists only in this tab's memory.
//
// "Stay logged in" (ticked by default): the open vault key is also kept on
// this device as a non-extractable key for 24 hours from login (@pnw/vault
// remember / resumeSession), so switching apps on a phone, or a reload, opens
// the books again without the passphrase. Log out forgets it. Without it, the
// books lock after 15 idle minutes and on any reload, as before.
//
// Receipt files are sealed one by one with the same vault key and kept in
// their own IndexedDB store; a bill holds only a reference and the file's
// SHA-256, which is checked whenever the file is opened. Backups carry the
// record and every sealed file.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Books, type Dimensions, type Settings, type TemplateId, applyTemplate, createBooks } from "@pnw/ledger";
import type { Payroll } from "@pnw/payroll";
import { type AttachmentRef, MAX_ATTACHMENT_BYTES, type Sales } from "@pnw/sales";
import { BRAND } from "@/brand";
import {
  AccountError,
  LEGACY_VAULT_ID,
  ROLES,
  accountSecret,
  conversationBackupKey,
  checkAccountPassphrase,
  findAccounts,
  hasLegacyVault,
  legacyOpen,
  normalizeUsername,
  recoverAccounts,
  vaultIdFor,
} from "./account";
import { saveOver } from "./vault_write";
import { type Company, companyFromJson, companyToJson, emptyCompany, roleOf } from "./company";
import type { PersonalEvent } from "./events";
import type { SharedCalendar } from "./shared_events";
import type { Jobs } from "./jobs";
import type { Schedule } from "./schedule";
import type { Mailbox } from "./mailbox";
import type { Review } from "./review";
import type { Funds } from "./funds";
import type { Rail } from "./rail";
import { type Role, type Work, emptyWork } from "./work";
import { markBackedUp } from "./backup_reminder";
import {
  type VaultSession,
  IndexedDbStore,
  VaultError,
  addRecovery,
  createVault,
  exportBackup,
  forgetSession,
  parseBackup,
  REMEMBER_MS,
  removeRecovery,
  requestPersistence,
  resetWithRecovery,
  resumeSession,
  sha256Hex,
  unlockVault,
} from "@pnw/vault";

const IDLE_LOCK_MS = 15 * 60 * 1000;

export type BooksStatus = "loading" | "new" | "locked" | "open";

/**
 * What setup asks for. A business picks a template and a fiscal year; a
 * person who works for one gives only their name, and gets blank books with
 * the work part alongside.
 */
export type SetupInput = Settings & { template: TemplateId | "blank"; username: string; passphrase: string; role: Role; stay?: boolean };

/** What a login came to: the books are open, or one username and passphrase opened both kinds and the person picks. */
export type UnlockOutcome = { opened: true } | { opened: false; choices: Role[] };

// Only records that an account exists on this device (to tell the front page which button to
// emphasise), never whose. localStorage can be blocked or cleared; the page works without it.
const HAS_ACCOUNT_FLAG = "pnw:has-account";

function readAccountFlag(): boolean {
  try {
    return localStorage.getItem(HAS_ACCOUNT_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeAccountFlag(): void {
  try {
    localStorage.setItem(HAS_ACCOUNT_FLAG, "1");
  } catch {
    // Blocked storage: the front page just won't lean towards Log in.
  }
  // An account now lives here: ask the browser not to clear it for space (@pnw/vault persistence.ts).
  void requestPersistence();
}

type BooksContextValue = {
  status: BooksStatus;
  /** True when books from before accounts are on this device (they open with a passphrase alone). */
  legacyAvailable: boolean;
  /** The open account's vault id (a hash of its username and role, or the old "default"); null while locked. */
  vaultId: string | null;
  /** The open account's username (an email on accounts made before usernames); null on books made before accounts, or while locked. */
  username: string | null;
  /** When a backup was last saved from these books (books/backup_reminder.ts); null before the first, or while locked. */
  backedUpAt: string | null;
  books: Books | null;
  payroll: Payroll | null;
  sales: Sales | null;
  dimensions: Dimensions | null;
  /** The linked account, or null while the books are closed or no account is linked. */
  rail: Rail | null;
  /** What other people have sent this business, or null while closed or before anything arrived. */
  mailbox: Mailbox | null;
  /** Money that moved in the Shield account, for review; null before anything was found. */
  review: Review | null;
  /** Set-asides inside the Shield account; null before one was made. */
  funds: Funds | null;
  /** The business's postings on the job board; null before one was posted. */
  jobs: Jobs | null;
  /** The business's schedule drafts (books/schedule.ts); null before one was drafted. */
  schedule: Schedule | null;
  /** Whose vault this is; "business" until the books are open. */
  role: Role;
  /** A person's own side (agreements, hours, paystubs), or null on a business's books. */
  work: Work | null;
  /** Personal events on this account's own calendar (books/events.ts); empty before the first. */
  events: readonly PersonalEvent[];
  /** Shared events: the ones this account organizes and its invitations (books/shared_events.ts); null before the first. */
  calendar: SharedCalendar | null;
  create: (input: SetupInput) => Promise<void>;
  /** Log in with a username and passphrase. Throws a message that never says which of the two was wrong. */
  /** `stay` (default true) keeps the books open on this device for 24 hours, until Log out. */
  unlock: (username: string, passphrase: string, stay?: boolean) => Promise<UnlockOutcome>;
  /** After `unlock` offered a choice: open the business or the worker account. */
  chooseAccount: (role: Role) => Promise<void>;
  /** Drop an offered choice (the dialog closed) and its keys. */
  cancelChoice: () => void;
  /** Open books created before accounts, with the passphrase alone. */
  unlockLegacy: (passphrase: string, stay?: boolean) => Promise<void>;
  /** Log out: drops the key and plaintext from memory, and forgets "stay logged in" on this device. */
  lock: () => void;
  /** When "stay logged in" ends, or null when the books aren't kept open. */
  stayUntil: Date | null;
  /** Apply a ledger operation; resolves once the result is safely stored. */
  update: (op: (books: Books) => Books) => Promise<Books>;
  /** Same, for operations that change the books with payroll or sales (a pay run, an invoice). */
  updateCompany: (op: (company: Company) => Company) => Promise<Company>;
  downloadBackup: () => Promise<void>;
  /**
   * Restore a backup file onto this device, then open it. The backup must belong to this username; a
   * backup from before accounts needs only the passphrase (pass null for the username).
   */
  restore: (fileText: string, username: string | null, passphrase: string, stay?: boolean) => Promise<void>;
  /**
   * The key a conversation backup for `account` is sealed with, from this account's username and
   * `passphrase` (books/account.ts `conversationBackupKey`). With `check`, the passphrase must open
   * these books first, so a typo can't make a backup nobody can restore.
   */
  backupKey: (passphrase: string, account: string, check: boolean) => Promise<string>;
  /**
   * A forgotten passphrase: the username and the recovery key set a new one, then the books open
   * (books/account.ts `recoverAccounts`). Throws one message whatever was wrong.
   */
  recover: (username: string, code: string, nextPassphrase: string, stay?: boolean) => Promise<UnlockOutcome>;
  /** The same from a backup file: the recovery key sets a new passphrase on the backup, then it restores. */
  restoreWithRecovery: (fileText: string, username: string, code: string, nextPassphrase: string, stay?: boolean) => Promise<void>;
  /** When the open books' recovery key was made, or null when they have none. */
  recoveryMadeAt: string | null;
  /** Makes a recovery key (replacing any earlier one) and returns its code, shown once. Takes the passphrase. */
  makeRecoveryKey: (passphrase: string) => Promise<string>;
  /** Takes the recovery key away. Takes the passphrase. */
  removeRecoveryKey: (passphrase: string) => Promise<void>;
  /** Seals a photo or PDF into the vault and returns the reference a bill keeps. */
  addAttachment: (file: File) => Promise<AttachmentRef>;
  /** Opens a sealed file, checking it against the fingerprint the bill holds. */
  readAttachment: (ref: AttachmentRef) => Promise<Blob>;
  /** Drops a sealed file nothing refers to (a bill that failed to save). */
  discardAttachment: (attachmentId: string) => Promise<void>;
};

const BooksContext = createContext<BooksContextValue | null>(null);
const NO_EVENTS: readonly PersonalEvent[] = [];

export function useBooks(): BooksContextValue {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error("useBooks must be used inside <BooksProvider>");
  return ctx;
}

/** Open books, for screens that only render once the gate has let them through. */
type OpenBooks = BooksContextValue & { books: Books; payroll: Payroll; sales: Sales; dimensions: Dimensions };

export function useOpenBooks(): OpenBooks {
  const ctx = useBooks();
  if (!ctx.books || !ctx.payroll || !ctx.sales || !ctx.dimensions) throw new Error("Books are not open");
  return ctx as OpenBooks;
}

/** A person's own side of the app, for screens that only render on a worker's vault. */
export function useWork(): OpenBooks & { work: Work; updateWork: (op: (work: Work) => Work) => Promise<Work> } {
  const ctx = useOpenBooks();
  const { updateCompany, work } = ctx;
  const updateWork = useCallback(
    async (op: (w: Work) => Work) => {
      const next = await updateCompany((c) => {
        if (!c.work) throw new Error("These books aren't a worker's");
        return { ...c, work: op(c.work) };
      });
      return next.work!;
    },
    [updateCompany],
  );
  if (!work) throw new Error("These books aren't a worker's");
  return { ...ctx, work, updateWork };
}

/** Turns the vault's "wrong passphrase" into a message of ours; anything else passes through. */
function rethrowWrong(message: string) {
  return (e: unknown): never => {
    throw e instanceof VaultError && e.code === "WRONG_PASSPHRASE" ? new AccountError(message) : e;
  };
}

const ATTACHMENT_TYPES = /^(image\/[a-z0-9.+-]+|application\/pdf)$/;

function newAttachmentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `att-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function BooksProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new IndexedDbStore(), []);
  const session = useRef<VaultSession | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const companyRef = useRef<Company | null>(null);
  // The record this tab last read or wrote, by its payload's IV (fresh on every write): a write finds
  // whether another tab or window wrote since, and refuses rather than overwrite it.
  const savedIv = useRef<string | null>(null);
  const pending = useRef<{ role: Role; session: VaultSession }[]>([]);
  const [status, setStatus] = useState<BooksStatus>("loading");
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [stayUntil, setStayUntil] = useState<Date | null>(null);
  const [recoveryMadeAt, setRecoveryMadeAt] = useState<string | null>(null);
  const stayChoice = useRef(true);

  const show = useCallback(async (s: VaultSession) => {
    const loaded = companyFromJson(await s.read());
    pending.current = [];
    session.current = s;
    savedIv.current = s.record.payload.iv;
    companyRef.current = loaded;
    setRecoveryMadeAt(s.record.recovery?.createdAt ?? null);
    setVaultId(s.id);
    setCompany(loaded);
    setStatus("open");
  }, []);

  /** Opens the books, and keeps them open on this device for 24 hours when `stay`. */
  const open = useCallback(
    async (s: VaultSession, stay: boolean) => {
      await show(s);
      if (stay) {
        const until = new Date(Date.now() + REMEMBER_MS);
        // A browser that can't keep the key (storage blocked, say) just doesn't stay logged in.
        const kept = await s.remember(store, until).then(
          () => true,
          () => false,
        );
        setStayUntil(kept ? until : null);
      } else {
        await forgetSession(store).catch(() => {});
        setStayUntil(null);
      }
    },
    [show, store],
  );

  // On load: reopen books kept open on this device, if any. Otherwise, is there anything here to
  // log in to? Books from before accounts, or the flag a created account leaves. The vault ids of
  // accounts are hashes of usernames, so the store can't be asked for them without one; the login
  // looks for them once the username is typed.
  useEffect(() => {
    let live = true;
    (async () => {
      const resumed = await resumeSession(store).catch(() => null);
      if (resumed && live) {
        try {
          await show(resumed.session);
          setStayUntil(resumed.expiresAt);
          return;
        } catch {
          await forgetSession(store).catch(() => {});
        }
      }
      if (!live) return;
      await hasLegacyVault(store).then(
        (legacy) => {
          setLegacyAvailable(legacy);
          setStatus(legacy || readAccountFlag() ? "locked" : "new");
        },
        () => setStatus(readAccountFlag() ? "locked" : "new"),
      );
    })();
    return () => {
      live = false;
    };
  }, [store, show]);

  const create = useCallback(
    async ({ template, username: rawUsername, passphrase, role, stay = true, ...settings }: SetupInput) => {
      const username = normalizeUsername(rawUsername);
      checkAccountPassphrase(passphrase, username);
      const id = await vaultIdFor(username, role);
      // Never overwrite: this screen is reachable on a device that already has accounts.
      if (await store.load(id)) {
        throw new AccountError(
          `There is already a ${role === "worker" ? "worker" : "business"} account with that username on this device. Log in, or pick a different username.`,
        );
      }
      let fresh = createBooks(settings);
      if (template !== "blank") fresh = applyTemplate(fresh, template);
      const base: Company = role === "worker" ? { ...emptyCompany(fresh), role, work: emptyWork(settings.businessName) } : emptyCompany(fresh);
      const s = await createVault(accountSecret(username, passphrase), companyToJson({ ...base, username }), { id });
      await store.save(s.record);
      writeAccountFlag();
      await open(s, stay);
    },
    [store, open],
  );

  const unlock = useCallback(
    async (username: string, passphrase: string, stay = true): Promise<UnlockOutcome> => {
      const found = await findAccounts(store, username, passphrase); // throws the one generic message
      writeAccountFlag();
      stayChoice.current = stay;
      if (found.length === 1) {
        await open(found[0]!.session, stay);
        return { opened: true };
      }
      pending.current.forEach((p) => p.session.lock());
      pending.current = found;
      return { opened: false, choices: found.map((f) => f.role) };
    },
    [store, open],
  );

  const chooseAccount = useCallback(
    async (role: Role) => {
      const pick = pending.current.find((p) => p.role === role);
      if (!pick) throw new Error("Log in again to choose");
      pending.current.filter((p) => p !== pick).forEach((p) => p.session.lock());
      await open(pick.session, stayChoice.current);
    },
    [open],
  );

  const cancelChoice = useCallback(() => {
    pending.current.forEach((p) => p.session.lock());
    pending.current = [];
  }, []);

  const unlockLegacy = useCallback(
    async (passphrase: string, stay = true) => {
      await open(await legacyOpen(store, passphrase), stay);
    },
    [store, open],
  );

  const lock = useCallback(() => {
    void forgetSession(store).catch(() => {});
    setStayUntil(null);
    session.current?.lock();
    session.current = null;
    savedIv.current = null;
    pending.current.forEach((p) => p.session.lock());
    pending.current = [];
    companyRef.current = null;
    setVaultId(null);
    setRecoveryMadeAt(null);
    setCompany(null);
    setStatus((s) => (s === "open" ? "locked" : s));
  }, [store]);

  // Updates run one at a time, each on the result of the last, so two quick
  // edits can never both start from the same stale copy of the books.
  const updateCompany = useCallback(
    (op: (c: Company) => Company) => {
      const run = queue.current.then(async () => {
        const s = session.current;
        const current = companyRef.current;
        if (!s || !current) throw new Error("Books are locked");
        const next = op(current); // throws on any broken rule; nothing is saved
        // Only over what this tab last saw: two tabs on the same books can't undo each other's writes (books/vault_write.ts).
        savedIv.current = await saveOver(store, s, companyToJson(next), savedIv.current);
        companyRef.current = next;
        setCompany(next);
        return next;
      });
      queue.current = run.catch(() => {});
      return run;
    },
    [store],
  );

  const update = useCallback(
    async (op: (b: Books) => Books) => (await updateCompany((c) => ({ ...c, books: op(c.books) }))).books,
    [updateCompany],
  );

  const downloadBackup = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    // Every sealed file goes in too, still encrypted: a restore brings the receipts back.
    const attachments = await store.listAttachments(s.id);
    const text = exportBackup(s.record, attachments);
    const name = (company?.books.settings.businessName ?? "books").replace(/[^\w-]+/g, "-").toLowerCase();
    const fileName = `${name}-${new Date().toISOString().slice(0, 10)}.${BRAND.backupExtension}`;
    // On a phone, the share sheet (save to Files, send to yourself): a plain download often goes
    // nowhere inside an app's own browser. Elsewhere, and if sharing isn't offered, a download.
    const file = new File([text], fileName, { type: "application/json" });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    if (touch && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: fileName });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // closed without saving: not backed up
        throw e;
      }
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    await updateCompany((c) => markBackedUp(c));
  }, [company, store, updateCompany]);

  const restore = useCallback(
    async (fileText: string, rawUsername: string | null, passphrase: string, stay = true) => {
      const backup = parseBackup(fileText);
      let s: VaultSession;
      if (backup.record.id === LEGACY_VAULT_ID) {
        // From before accounts: the passphrase alone, as ever.
        s = await unlockVault(backup.record, passphrase).catch(rethrowWrong("That passphrase doesn't open this backup"));
      } else {
        const username = normalizeUsername(rawUsername ?? "");
        const ids = await Promise.all(ROLES.map((role) => vaultIdFor(username, role)));
        if (!ids.includes(backup.record.id)) throw new AccountError("This backup belongs to a different account");
        s = await unlockVault(backup.record, accountSecret(username, passphrase)).catch(
          rethrowWrong("That username and passphrase don't open this backup"),
        ); // proves them before anything is replaced
      }
      companyFromJson(await s.read()); // and that the books inside are intact
      for (const a of backup.attachments) await s.openAttachment(a); // and every file
      await store.replace(s.record, backup.attachments);
      writeAccountFlag();
      if (backup.record.id === LEGACY_VAULT_ID) setLegacyAvailable(true);
      await open(s, stay);
    },
    [store, open],
  );

  const recover = useCallback(
    async (username: string, code: string, nextPassphrase: string, stay = true): Promise<UnlockOutcome> => {
      const found = await recoverAccounts(store, username, code, nextPassphrase); // throws the one generic message
      writeAccountFlag();
      stayChoice.current = stay;
      if (found.length === 1) {
        await open(found[0]!.session, stay);
        return { opened: true };
      }
      pending.current.forEach((p) => p.session.lock());
      pending.current = found;
      return { opened: false, choices: found.map((f) => f.role) };
    },
    [store, open],
  );

  const restoreWithRecovery = useCallback(
    async (fileText: string, rawUsername: string, code: string, nextPassphrase: string, stay = true) => {
      const backup = parseBackup(fileText);
      const username = normalizeUsername(rawUsername);
      checkAccountPassphrase(nextPassphrase, username);
      const ids = await Promise.all(ROLES.map((role) => vaultIdFor(username, role)));
      if (backup.record.id === LEGACY_VAULT_ID || !ids.includes(backup.record.id)) throw new AccountError("This backup belongs to a different account");
      const secret = accountSecret(username, nextPassphrase);
      const record = await resetWithRecovery(backup.record, code, secret).catch((e: unknown) => {
        throw e instanceof VaultError && e.code === "WRONG_RECOVERY_KEY" ? new AccountError("That recovery key doesn't open this backup") : e;
      });
      const s = await unlockVault(record, secret);
      companyFromJson(await s.read()); // the books inside are intact
      for (const a of backup.attachments) await s.openAttachment(a); // and every file
      await store.replace(s.record, backup.attachments);
      writeAccountFlag();
      await open(s, stay);
    },
    [store, open],
  );

  /**
   * Swaps in a record whose key slots changed (a recovery key made or taken away), in the queue
   * with every other write. The books are written again with it, so another tab sees a change and
   * stops instead of saving over it without the new slot.
   */
  const replaceSlots = useCallback(
    (change: (record: VaultSession["record"], secret: string) => Promise<{ record: VaultSession["record"]; code?: string }>, passphrase: string) => {
      const run = queue.current.then(async () => {
        const s = session.current;
        const current = companyRef.current;
        if (!s || !current) throw new Error("Books are locked");
        const secret = current.username ? accountSecret(current.username, passphrase) : passphrase;
        const { record, code } = await change(s.record, secret).catch(rethrowWrong("That isn't the passphrase for these books"));
        const next = await unlockVault(record, secret);
        savedIv.current = await saveOver(store, next, companyToJson(current), savedIv.current);
        session.current = next;
        s.lock();
        setRecoveryMadeAt(next.record.recovery?.createdAt ?? null);
        return code;
      });
      queue.current = run.catch(() => {});
      return run;
    },
    [store],
  );

  const makeRecoveryKey = useCallback(
    async (passphrase: string) => (await replaceSlots((record, secret) => addRecovery(record, secret), passphrase))!,
    [replaceSlots],
  );

  const removeRecoveryKey = useCallback(
    async (passphrase: string) => {
      await replaceSlots(async (record, secret) => ({ record: await removeRecovery(record, secret) }), passphrase);
    },
    [replaceSlots],
  );

  const addAttachment = useCallback(
    async (file: File): Promise<AttachmentRef> => {
      const s = session.current;
      if (!s) throw new Error("Books are locked");
      if (!ATTACHMENT_TYPES.test(file.type)) throw new Error("Attach a photo or a PDF");
      if (file.size === 0) throw new Error("That file is empty");
      if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("Files can be at most 10 MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const attachmentId = newAttachmentId();
      const sha256 = await sha256Hex(bytes);
      await store.saveAttachment(s.id, await s.sealAttachment(attachmentId, bytes));
      return { attachmentId, sha256, type: file.type, size: bytes.length, name: file.name || "receipt" };
    },
    [store],
  );

  const backupKey = useCallback(
    async (passphrase: string, account: string, check: boolean) => {
      const username = company?.username ?? null;
      const secret = username ? accountSecret(username, passphrase) : passphrase;
      if (check) {
        const s = session.current;
        if (!s) throw new Error("The books are locked");
        await unlockVault(s.record, secret).then(
          (opened) => opened.lock(),
          () => {
            throw new Error("That isn't the passphrase for these books");
          },
        );
      }
      return conversationBackupKey(secret, account);
    },
    [company?.username],
  );

  const readAttachment = useCallback(
    async (ref: AttachmentRef): Promise<Blob> => {
      const s = session.current;
      if (!s) throw new Error("Books are locked");
      const sealed = await store.loadAttachment(s.id, ref.attachmentId);
      if (!sealed) throw new Error("That file isn't on this device. Restore a backup that includes it.");
      const bytes = await s.openAttachment(sealed);
      if ((await sha256Hex(bytes)) !== ref.sha256) throw new Error("That file doesn't match the one attached to this bill");
      return new Blob([bytes], { type: ref.type });
    },
    [store],
  );

  const discardAttachment = useCallback(
    async (attachmentId: string) => {
      const s = session.current;
      if (s) await store.removeAttachment(s.id, attachmentId);
    },
    [store],
  );

  // Kept open: log out when the 24 hours are up. Not kept: auto-lock after inactivity.
  useEffect(() => {
    if (status !== "open" || !stayUntil) return;
    const timer = setTimeout(lock, Math.max(0, stayUntil.getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [status, stayUntil, lock]);

  useEffect(() => {
    if (status !== "open" || stayUntil) return;
    let timer = setTimeout(lock, IDLE_LOCK_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, IDLE_LOCK_MS);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [status, stayUntil, lock]);

  const value = useMemo(
    () => ({
      status,
      legacyAvailable,
      vaultId,
      username: company?.username ?? null,
      backedUpAt: company?.backedUpAt ?? null,
      books: company?.books ?? null,
      payroll: company?.payroll ?? null,
      sales: company?.sales ?? null,
      dimensions: company?.dimensions ?? null,
      rail: company?.rail ?? null,
      mailbox: company?.mailbox ?? null,
      review: company?.review ?? null,
      funds: company?.funds ?? null,
      jobs: company?.jobs ?? null,
      schedule: company?.schedule ?? null,
      role: company ? roleOf(company) : "business",
      work: company?.work ?? null,
      events: company?.events ?? NO_EVENTS,
      calendar: company?.calendar ?? null,
      create,
      unlock,
      chooseAccount,
      cancelChoice,
      unlockLegacy,
      lock,
      stayUntil,
      update,
      updateCompany,
      downloadBackup,
      restore,
      backupKey,
      recover,
      restoreWithRecovery,
      recoveryMadeAt,
      makeRecoveryKey,
      removeRecoveryKey,
      addAttachment,
      readAttachment,
      discardAttachment,
    }),
    [
      status,
      legacyAvailable,
      vaultId,
      company,
      create,
      unlock,
      chooseAccount,
      cancelChoice,
      unlockLegacy,
      lock,
      stayUntil,
      update,
      updateCompany,
      downloadBackup,
      restore,
      backupKey,
      recover,
      restoreWithRecovery,
      recoveryMadeAt,
      makeRecoveryKey,
      removeRecoveryKey,
      addAttachment,
      readAttachment,
      discardAttachment,
    ],
  );
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}
