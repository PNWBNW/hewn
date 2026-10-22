// ---------------------------------------------------------------------------
// The encrypted vault: one sealed record per business.
//
// Key scheme (envelope encryption):
//   data key  — random AES-256-GCM key. Encrypts the books. Never stored in
//               the clear and never extractable once the vault is open.
//   unlock key — derived from the passphrase with PBKDF2-SHA256 (600k rounds,
//               random 16-byte salt). It only wraps the data key.
//
// Changing the passphrase, adding a wallet signature as a second unlock, or
// (Phase 6) giving each team member their own wrapped copy all re-wrap the
// small data key, never re-encrypt the books. Every ciphertext is bound to
// the vault id and its role with AES-GCM associated data, so pieces can't be
// swapped between vaults or between the key and payload slots.
//
// Attachments (receipt photos, PDFs) are sealed one by one with the same
// data key, each bound to the vault id and its own `attachment:<id>` role,
// so the company file never carries file bytes and re-saving the books
// never re-encrypts them. A backup file (version 2) is the record plus
// those sealed attachments, still encrypted.
//
// All crypto is the browser's own WebCrypto; nothing here implements a cipher.
// ---------------------------------------------------------------------------

import type { VaultStore } from "./store";

export const VAULT_FORMAT = "pnw-vault";
export const KDF_ITERATIONS = 600_000;
/**
 * The most rounds a record may ask for. The rounds are read from the record, so a doctored backup
 * could ask for billions and keep the device working for hours on import. This app never writes
 * more than KDF_ITERATIONS, and the limit moves with it.
 */
export const MAX_KDF_ITERATIONS = KDF_ITERATIONS * 10;
export const MIN_PASSPHRASE = 10;

type Sealed = { iv: string; data: string };

/** One sealed attachment, as stored and as written into backups. */
export type SealedAttachment = { id: string; iv: string; data: string };

export const BACKUP_FORMAT = "pnw-vault-backup";

/** What a backup file holds: the sealed record and every sealed attachment. */
export type Backup = { record: VaultRecord; attachments: SealedAttachment[] };

export type VaultRecord = {
  format: typeof VAULT_FORMAT;
  version: 1;
  id: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  wrappedKey: Sealed;
  payload: Sealed;
  updatedAt: string;
};

export type VaultErrorCode = "WEAK_PASSPHRASE" | "WRONG_PASSPHRASE" | "CORRUPT" | "NOT_A_VAULT";

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

// ---- helpers ---------------------------------------------------------------

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  // In chunks: a 10 MB photo one character at a time is slow, and all at once overflows the stack.
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
type Role = "key" | "data" | `attachment:${string}`;
const aad = (id: string, role: Role) => enc.encode(`${VAULT_FORMAT}:v1:${role}:${id}`);

function attachmentRole(attachmentId: string): Role {
  // No colons, so the role and the vault id can't be shifted into each other.
  if (!ATTACHMENT_ID.test(attachmentId)) throw new VaultError("CORRUPT", "That attachment id isn't valid");
  return `attachment:${attachmentId}`;
}

/** SHA-256 of some bytes, as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function checkPassphrase(passphrase: string): string {
  const normalized = passphrase.normalize("NFKC");
  if ([...normalized].length < MIN_PASSPHRASE) {
    throw new VaultError("WEAK_PASSPHRASE", `Use at least ${MIN_PASSPHRASE} characters`);
  }
  return normalized;
}

async function unlockKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

async function seal(key: CryptoKey, plaintext: string, ad: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = random(12);
  const data = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: ad }, key, enc.encode(plaintext));
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}

async function sealBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, ad: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = random(12);
  const data = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: ad }, key, bytes);
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}

async function openBytes(key: CryptoKey, sealed: Sealed, ad: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: unb64(sealed.iv), additionalData: ad }, key, unb64(sealed.data)));
  } catch {
    throw new VaultError("CORRUPT", "The vault data is damaged or was changed outside the app");
  }
}

async function open(key: CryptoKey, sealed: Sealed, ad: Uint8Array<ArrayBuffer>): Promise<string> {
  return dec.decode(await openBytes(key, sealed, ad));
}

async function unwrapDataKey(kek: CryptoKey, record: VaultRecord): Promise<CryptoKey> {
  return subtle().unwrapKey(
    "raw",
    unb64(record.wrappedKey.data),
    kek,
    { name: "AES-GCM", iv: unb64(record.wrappedKey.iv), additionalData: aad(record.id, "key") },
    { name: "AES-GCM", length: 256 },
    false, // the open data key can never be exported
    ["encrypt", "decrypt"],
  );
}

async function wrapDataKey(kek: CryptoKey, dataKey: CryptoKey, id: string): Promise<Sealed> {
  const iv = random(12);
  const data = await subtle().wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv, additionalData: aad(id, "key") });
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}

// ---- session ---------------------------------------------------------------

/**
 * An unlocked vault. Holds the data key in memory only; `lock()` drops it.
 * The key object can't be exported, so even code that gets a session can
 * only encrypt and decrypt through these methods.
 */
export class VaultSession {
  #key: CryptoKey | null;
  #record: VaultRecord;

  constructor(key: CryptoKey, record: VaultRecord) {
    this.#key = key;
    this.#record = record;
  }

  get id(): string {
    return this.#record.id;
  }

  get locked(): boolean {
    return this.#key === null;
  }

  #requireKey(): CryptoKey {
    if (!this.#key) throw new VaultError("WRONG_PASSPHRASE", "The vault is locked");
    return this.#key;
  }

  /** The decrypted contents of the current record. */
  async read(): Promise<string> {
    return open(this.#requireKey(), this.#record.payload, aad(this.#record.id, "data"));
  }

  /** Encrypts new contents (fresh IV) and returns the record to store. */
  async write(plaintext: string, now = new Date().toISOString()): Promise<VaultRecord> {
    const payload = await seal(this.#requireKey(), plaintext, aad(this.#record.id, "data"));
    this.#record = { ...this.#record, payload, updatedAt: now };
    return this.#record;
  }

  get record(): VaultRecord {
    return this.#record;
  }

  /** Seals a file with the data key, bound to this vault and to `attachmentId`. */
  async sealAttachment(attachmentId: string, bytes: Uint8Array<ArrayBuffer>): Promise<SealedAttachment> {
    const sealed = await sealBytes(this.#requireKey(), bytes, aad(this.#record.id, attachmentRole(attachmentId)));
    return { id: attachmentId, ...sealed };
  }

  /** Opens a sealed attachment. Fails if it belongs to another vault or id, or was changed. */
  async openAttachment(sealed: SealedAttachment): Promise<Uint8Array<ArrayBuffer>> {
    return openBytes(this.#requireKey(), sealed, aad(this.#record.id, attachmentRole(sealed.id)));
  }

  /**
   * "Stay logged in": keeps this session's data key on this device until `expiresAt`, so the books
   * reopen without the passphrase (resumeSession). The key is the browser's non-extractable
   * CryptoKey: whoever holds the device can use it to open the books until it expires or
   * forgetSession runs, but nobody can read it out or copy it elsewhere.
   */
  async remember(store: VaultStore, expiresAt: Date): Promise<void> {
    const key = this.#requireKey();
    if (key.extractable) throw new VaultError("CORRUPT", "Only a non-extractable key can be remembered");
    await store.saveRemembered({ vaultId: this.#record.id, key, expiresAt: expiresAt.toISOString() });
  }

  lock(): void {
    this.#key = null;
  }
}

/** The longest a remembered session may last. */
export const REMEMBER_MS = 24 * 60 * 60 * 1000;

/**
 * Reopens the remembered session, if there is one and it hasn't expired. Anything wrong with it
 * (expired, an expiry further out than REMEMBER_MS, an extractable key, a missing or damaged
 * record) clears it and returns null.
 */
export async function resumeSession(store: VaultStore, now: Date = new Date()): Promise<{ session: VaultSession; expiresAt: Date } | null> {
  const r = await store.loadRemembered();
  if (!r) return null;
  const expires = Date.parse(r.expiresAt);
  const usable =
    Number.isFinite(expires) &&
    expires > now.getTime() &&
    expires - now.getTime() <= REMEMBER_MS &&
    typeof r.key === "object" &&
    r.key !== null &&
    r.key.extractable === false;
  const record = usable ? await store.load(r.vaultId) : null;
  if (record) {
    try {
      const session = new VaultSession(r.key, record);
      await session.read();
      return { session, expiresAt: new Date(expires) };
    } catch {
      // the key doesn't open this record: forget it below
    }
  }
  await store.clearRemembered();
  return null;
}

/** Forgets the remembered session on this device (Log out). */
export async function forgetSession(store: VaultStore): Promise<void> {
  await store.clearRemembered();
}

// ---- create / unlock -------------------------------------------------------

export async function createVault(
  passphrase: string,
  plaintext: string,
  options: { id?: string; iterations?: number; now?: string } = {},
): Promise<VaultSession> {
  const normalized = checkPassphrase(passphrase);
  const id = options.id ?? "default";
  const iterations = options.iterations ?? KDF_ITERATIONS;
  const salt = random(16);
  const kek = await unlockKey(normalized, salt, iterations);

  // Generated extractable only so it can be wrapped once; the session gets a
  // non-extractable copy unwrapped from the stored record.
  const fresh = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const draft: VaultRecord = {
    format: VAULT_FORMAT,
    version: 1,
    id,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: b64(salt) },
    wrappedKey: await wrapDataKey(kek, fresh, id),
    payload: { iv: "", data: "" },
    updatedAt: options.now ?? new Date().toISOString(),
  };
  const session = new VaultSession(await unwrapDataKey(kek, draft), draft);
  await session.write(plaintext, draft.updatedAt);
  return session;
}

export async function unlockVault(record: VaultRecord, passphrase: string): Promise<VaultSession> {
  assertRecord(record);
  const kek = await unlockKey(passphrase.normalize("NFKC"), unb64(record.kdf.salt), record.kdf.iterations);
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(kek, record);
  } catch {
    throw new VaultError("WRONG_PASSPHRASE", "That passphrase doesn't open these books");
  }
  const session = new VaultSession(key, record);
  await session.read(); // fail now, not later, if the payload is damaged
  return session;
}

/** Re-wraps the data key under a new passphrase. The books aren't re-encrypted. */
export async function changePassphrase(
  record: VaultRecord,
  current: string,
  next: string,
  options: { iterations?: number } = {},
): Promise<VaultRecord> {
  assertRecord(record);
  const normalized = checkPassphrase(next);
  const oldKek = await unlockKey(current.normalize("NFKC"), unb64(record.kdf.salt), record.kdf.iterations);
  // Unwrap extractable just long enough to re-wrap it.
  let raw: CryptoKey;
  try {
    raw = await subtle().unwrapKey(
      "raw",
      unb64(record.wrappedKey.data),
      oldKek,
      { name: "AES-GCM", iv: unb64(record.wrappedKey.iv), additionalData: aad(record.id, "key") },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new VaultError("WRONG_PASSPHRASE", "That passphrase doesn't open these books");
  }
  const salt = random(16);
  const iterations = options.iterations ?? Math.max(record.kdf.iterations, KDF_ITERATIONS);
  const kek = await unlockKey(normalized, salt, iterations);
  return {
    ...record,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: b64(salt) },
    wrappedKey: await wrapDataKey(kek, raw, record.id),
  };
}

// ---- backup files ----------------------------------------------------------

/**
 * A backup is the sealed record plus every sealed attachment: still
 * encrypted, opened with the same passphrase. Version 2; a version-1 file
 * (the bare record, from before attachments) still restores.
 */
export function exportBackup(record: VaultRecord, attachments: SealedAttachment[] = []): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 2, record, attachments }, null, 2);
}

export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError("NOT_A_VAULT", "That file isn't a books backup from this app");
  }
  const doc = parsed as { format?: unknown; version?: unknown; record?: unknown; attachments?: unknown } | null;
  if (doc?.format !== BACKUP_FORMAT) {
    assertRecord(parsed); // version 1: the record on its own
    return { record: parsed, attachments: [] };
  }
  if (doc.version !== 2 || !Array.isArray(doc.attachments)) {
    throw new VaultError("NOT_A_VAULT", "That backup is from a newer version of this app");
  }
  assertRecord(doc.record);
  const attachments = doc.attachments.map((a: unknown): SealedAttachment => {
    const x = a as Partial<SealedAttachment> | null;
    if (!x || typeof x.id !== "string" || !ATTACHMENT_ID.test(x.id) || typeof x.iv !== "string" || typeof x.data !== "string") {
      throw new VaultError("NOT_A_VAULT", "That file isn't a books backup from this app");
    }
    return { id: x.id, iv: x.iv, data: x.data };
  });
  return { record: doc.record, attachments };
}

function assertRecord(value: unknown): asserts value is VaultRecord {
  const r = value as Partial<VaultRecord> | null;
  const sealedOk = (s: unknown) =>
    !!s && typeof (s as Sealed).iv === "string" && typeof (s as Sealed).data === "string";
  if (
    !r ||
    r.format !== VAULT_FORMAT ||
    r.version !== 1 ||
    typeof r.id !== "string" ||
    r.kdf?.name !== "PBKDF2-SHA256" ||
    !Number.isInteger(r.kdf.iterations) ||
    r.kdf.iterations < 1 ||
    r.kdf.iterations > MAX_KDF_ITERATIONS ||
    typeof r.kdf.salt !== "string" ||
    !sealedOk(r.wrappedKey) ||
    !sealedOk(r.payload)
  ) {
    throw new VaultError("NOT_A_VAULT", "That file isn't a books backup from this app");
  }
}
