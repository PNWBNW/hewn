// ---------------------------------------------------------------------------
// Accounts on this device.
//
// An account is a username plus a passphrase (Joshua, 2026-10-21: usernames
// rather than emails, since nothing is ever sent to an email). There is no
// server: the username is the account's name on this device and part of the
// secret the vault key is wrapped with, so the passphrase alone can't open an
// account even with the file in hand. The vault id is a hash of the username
// and the role, so one username can hold both a business and a worker
// account, and a person can find "their" vault without the device keeping a
// list of usernames.
//
// Accounts made before usernames were made with an email. An email is still
// a valid username and normalises exactly as it did, so those accounts open
// as they always have: nothing in a vault changes.
//
// Books created before accounts live in the vault "default" and open with the
// passphrase alone (`legacyOpen`).
//
// Pure: no React, no storage of its own. Everything takes a `VaultStore`, so
// tests run on a `MemoryStore` with small PBKDF2 rounds.
// ---------------------------------------------------------------------------

import { type VaultSession, type VaultStore, KDF_ITERATIONS, VaultError, checkNewPassphrase, sha256Hex, unlockVault } from "@pnw/vault";
import type { Role } from "./work";

/** The two kinds of account a username can hold. */
export const ROLES: readonly Role[] = ["business", "worker"];

/** The one vault id from before accounts existed. */
export const LEGACY_VAULT_ID = "default";

/** A username's length; an email (how accounts were made before usernames) may run to MAX_EMAIL_LENGTH. */
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 32;
export const MAX_EMAIL_LENGTH = 254;

/** What a failed login says. It never tells a wrong username from a wrong passphrase. */
export const NO_MATCH_MESSAGE = "That username and passphrase don't match an account on this device";

/** What a failed pre-accounts login says. */
export const LEGACY_NO_MATCH_MESSAGE = "That passphrase doesn't open these books";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_SHAPE = /^[\p{L}\p{N}._-]+$/u;

/** A problem the person can fix; the message is safe to show as it is. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * The username as the account knows it: trimmed, Unicode-normalised (NFKC) and lower-cased.
 * A username is 3 to 32 letters, numbers, dots, dashes or underscores. An email address (how
 * accounts were made before usernames) is accepted too, normalised exactly as it always was.
 */
export function normalizeUsername(raw: string): string {
  const name = raw.trim().normalize("NFKC").toLowerCase();
  if (name.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(name)) return name;
  const length = [...name].length;
  if (length < MIN_USERNAME_LENGTH || length > MAX_USERNAME_LENGTH || !USERNAME_SHAPE.test(name)) {
    throw new AccountError(`A username is ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} letters, numbers, dots, dashes or underscores`);
  }
  return name;
}

/** True when `raw` is an acceptable username (after normalising). */
export function isUsername(raw: string): boolean {
  try {
    normalizeUsername(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup's rule for a new passphrase (`@pnw/vault` `checkNewPassphrase`): at least 12 characters, a
 * letter and a space or symbol, not a common password or the username. The secret always has the
 * username in it, so the vault can't enforce this itself. Existing accounts open with what they were made with.
 */
export function checkAccountPassphrase(passphrase: string, username = ""): void {
  const check = checkNewPassphrase(passphrase, username);
  if (!check.ok) throw new VaultError("WEAK_PASSPHRASE", check.problems[0]!);
}

/**
 * The vault id of one account: a hash of the role and the (already
 * normalised) username, so the id says nothing a stranger can read.
 */
export async function vaultIdFor(username: string, role: Role): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(`hewn:acct:v1:${role}:${username}`));
  return `acct-${digest.slice(0, 32)}`;
}

/**
 * What the vault key is wrapped with: the (already normalised) username and
 * the passphrase together. Pass this, not the bare passphrase, to
 * `createVault` and `unlockVault`.
 */
export function accountSecret(username: string, passphrase: string): string {
  return `hewn:v1\n${username}\n${passphrase.normalize("NFKC")}`;
}

/**
 * The key a conversation backup on chain is sealed with (books/conversation_backup.ts): from the
 * same unlock secret as the books, salted with the account the backup letter goes to, so the same
 * username and passphrase open it on any device. 64 hex characters.
 */
export async function conversationBackupKey(secret: string, account: string, iterations: number = KDF_ITERATIONS): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const salt = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(`PNW::BACKUP::v1\n${account}`)));
  const material = await subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** An account that opened. The session holds its (non-extractable) data key. */
export type FoundAccount = { role: Role; session: VaultSession };

type Options = { iterations?: number };

/**
 * A failed login should take about as long as a real one, or the wait tells
 * a bystander which usernames have an account here. One key derivation at the
 * same cost, thrown away.
 */
async function decoy(iterations: number): Promise<void> {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode("decoy"), "PBKDF2", false, ["deriveBits"]);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
}

/**
 * Every account on this device that this username and passphrase open: none,
 * one, or two (the same username holding both a business and a worker
 * account under one passphrase). Throws `AccountError` with the generic message when
 * none opens; a damaged vault throws the vault's own error, since only the
 * right passphrase gets that far.
 */
export async function findAccounts(
  store: VaultStore,
  rawUsername: string,
  passphrase: string,
  { iterations = KDF_ITERATIONS }: Options = {},
): Promise<FoundAccount[]> {
  const username = normalizeUsername(rawUsername);
  const secret = accountSecret(username, passphrase);
  let tried = 0;
  const results = await Promise.all(
    ROLES.map(async (role): Promise<FoundAccount | null> => {
      const record = await store.load(await vaultIdFor(username, role));
      if (!record) return null;
      tried++;
      try {
        return { role, session: await unlockVault(record, secret) };
      } catch (e) {
        if (e instanceof VaultError && e.code !== "CORRUPT") return null; // wrong passphrase, or not a vault at all
        throw e;
      }
    }),
  );
  const found = results.filter((r): r is FoundAccount => r !== null);
  if (found.length === 0) {
    if (tried === 0) await decoy(iterations);
    throw new AccountError(NO_MATCH_MESSAGE);
  }
  return found;
}

/** Is there a vault from before accounts on this device? */
export async function hasLegacyVault(store: VaultStore): Promise<boolean> {
  return (await store.load(LEGACY_VAULT_ID)) !== null;
}

/** Opens books created before accounts, with the passphrase alone. */
export async function legacyOpen(store: VaultStore, passphrase: string, { iterations = KDF_ITERATIONS }: Options = {}): Promise<VaultSession> {
  const record = await store.load(LEGACY_VAULT_ID);
  if (!record) {
    await decoy(iterations);
    throw new AccountError(LEGACY_NO_MATCH_MESSAGE);
  }
  try {
    return await unlockVault(record, passphrase);
  } catch (e) {
    if (e instanceof VaultError && e.code !== "CORRUPT") throw new AccountError(LEGACY_NO_MATCH_MESSAGE);
    throw e;
  }
}
