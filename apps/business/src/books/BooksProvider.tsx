"use client";

// ---------------------------------------------------------------------------
// Holds the open books for the whole app.
//
// Lifecycle: loading → "new" (no books on this device yet) or "locked" →
// "open". Every change goes through `update`, which runs a pure ledger
// operation, then seals the result and saves it to IndexedDB before the
// screen moves on. Plaintext exists only in this tab's memory; locking (or
// 15 idle minutes) drops it along with the vault key.
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
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import {
  type VaultSession,
  IndexedDbStore,
  createVault,
  exportBackup,
  parseBackup,
  sha256Hex,
  unlockVault,
} from "@pnw/vault";

const VAULT_ID = "default";
const IDLE_LOCK_MS = 15 * 60 * 1000;

export type BooksStatus = "loading" | "new" | "locked" | "open";

export type SetupInput = Settings & { template: TemplateId | "blank"; passphrase: string };

type BooksContextValue = {
  status: BooksStatus;
  books: Books | null;
  payroll: Payroll | null;
  sales: Sales | null;
  dimensions: Dimensions | null;
  create: (input: SetupInput) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  /** Apply a ledger operation; resolves once the result is safely stored. */
  update: (op: (books: Books) => Books) => Promise<Books>;
  /** Same, for operations that change the books with payroll or sales (a pay run, an invoice). */
  updateCompany: (op: (company: Company) => Company) => Promise<Company>;
  downloadBackup: () => Promise<void>;
  /** Restore a backup file onto this device, then open it. */
  restore: (fileText: string, passphrase: string) => Promise<void>;
  /** Seals a photo or PDF into the vault and returns the reference a bill keeps. */
  addAttachment: (file: File) => Promise<AttachmentRef>;
  /** Opens a sealed file, checking it against the fingerprint the bill holds. */
  readAttachment: (ref: AttachmentRef) => Promise<Blob>;
  /** Drops a sealed file nothing refers to (a bill that failed to save). */
  discardAttachment: (attachmentId: string) => Promise<void>;
};

const BooksContext = createContext<BooksContextValue | null>(null);

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
  const [status, setStatus] = useState<BooksStatus>("loading");
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    store.load(VAULT_ID).then(
      (record) => setStatus(record ? "locked" : "new"),
      () => setStatus("new"),
    );
  }, [store]);

  const open = useCallback(async (s: VaultSession) => {
    const loaded = companyFromJson(await s.read());
    session.current = s;
    companyRef.current = loaded;
    setCompany(loaded);
    setStatus("open");
  }, []);

  const create = useCallback(
    async ({ template, passphrase, ...settings }: SetupInput) => {
      let fresh = createBooks(settings);
      if (template !== "blank") fresh = applyTemplate(fresh, template);
      const s = await createVault(passphrase, companyToJson(emptyCompany(fresh)), { id: VAULT_ID });
      await store.save(s.record);
      await open(s);
    },
    [store, open],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      const record = await store.load(VAULT_ID);
      if (!record) {
        setStatus("new");
        return;
      }
      await open(await unlockVault(record, passphrase));
    },
    [store, open],
  );

  const lock = useCallback(() => {
    session.current?.lock();
    session.current = null;
    companyRef.current = null;
    setCompany(null);
    setStatus((s) => (s === "open" ? "locked" : s));
  }, []);

  // Updates run one at a time, each on the result of the last, so two quick
  // edits can never both start from the same stale copy of the books.
  const updateCompany = useCallback(
    (op: (c: Company) => Company) => {
      const run = queue.current.then(async () => {
        const s = session.current;
        const current = companyRef.current;
        if (!s || !current) throw new Error("Books are locked");
        const next = op(current); // throws on any broken rule; nothing is saved
        await store.save(await s.write(companyToJson(next)));
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
    const attachments = await store.listAttachments(VAULT_ID);
    const blob = new Blob([exportBackup(s.record, attachments)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = (company?.books.settings.businessName ?? "books").replace(/[^\w-]+/g, "-").toLowerCase();
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.${BRAND.backupExtension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [company, store]);

  const restore = useCallback(
    async (fileText: string, passphrase: string) => {
      const backup = parseBackup(fileText);
      const record = { ...backup.record, id: VAULT_ID };
      const s = await unlockVault(record, passphrase); // proves the passphrase before anything is replaced
      companyFromJson(await s.read()); // and that the books inside are intact
      for (const a of backup.attachments) await s.openAttachment(a); // and every file
      await store.replace(s.record, backup.attachments);
      await open(s);
    },
    [store, open],
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
      await store.saveAttachment(VAULT_ID, await s.sealAttachment(attachmentId, bytes));
      return { attachmentId, sha256, type: file.type, size: bytes.length, name: file.name || "receipt" };
    },
    [store],
  );

  const readAttachment = useCallback(
    async (ref: AttachmentRef): Promise<Blob> => {
      const s = session.current;
      if (!s) throw new Error("Books are locked");
      const sealed = await store.loadAttachment(VAULT_ID, ref.attachmentId);
      if (!sealed) throw new Error("That file isn't on this device. Restore a backup that includes it.");
      const bytes = await s.openAttachment(sealed);
      if ((await sha256Hex(bytes)) !== ref.sha256) throw new Error("That file doesn't match the one attached to this bill");
      return new Blob([bytes], { type: ref.type });
    },
    [store],
  );

  const discardAttachment = useCallback((attachmentId: string) => store.removeAttachment(VAULT_ID, attachmentId), [store]);

  // Auto-lock after inactivity.
  useEffect(() => {
    if (status !== "open") return;
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
  }, [status, lock]);

  const value = useMemo(
    () => ({
      status,
      books: company?.books ?? null,
      payroll: company?.payroll ?? null,
      sales: company?.sales ?? null,
      dimensions: company?.dimensions ?? null,
      create,
      unlock,
      lock,
      update,
      updateCompany,
      downloadBackup,
      restore,
      addAttachment,
      readAttachment,
      discardAttachment,
    }),
    [status, company, create, unlock, lock, update, updateCompany, downloadBackup, restore, addAttachment, readAttachment, discardAttachment],
  );
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}
