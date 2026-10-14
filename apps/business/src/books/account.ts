// ---------------------------------------------------------------------------
// Accounts on this device.
//
// An account is an email plus a passphrase. There is no server: the email is
// the account's name on this device and part of the secret the vault key is
// wrapped with, so the passphrase alone can no longer open an account even
// with the file in hand. The vault id is a hash of the email and the role, so
// one email can hold both a business and a worker account, and a person can
// find "their" vault without the device keeping a list of emails.
//
// Books created before accounts live in the vault "default" and open with the
// passphrase alone (`legacyOpen`).
//
// Pure: no React, no storage of its own. Everything takes a `VaultStore`, so
// tests run on a `MemoryStore` with small PBKDF2 rounds.
// ---------------------------------------------------------------------------

import { type VaultSession, type VaultStore, KDF_ITERATIONS, MIN_PASSPHRASE, VaultError, sha256Hex, unlockVault } from "@pnw/vault";
import type { Role } from "./work";

/** The two kinds of account an email can hold. */
export const ROLES: readonly Role[] = ["business", "worker"];

/** The one vault id from before accounts existed. */
export const LEGACY_VAULT_ID = "default";

export const MAX_EMAIL_LENGTH = 254;

/** What a failed login says. It never tells a wrong email from a wrong passphrase. */
export const NO_MATCH_MESSAGE = "That email and passphrase don't match an account on this device";

/** What a failed pre-accounts login says. */
export const LEGACY_NO_MATCH_MESSAGE = "That passphrase doesn't open these books";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A problem the person can fix; the message is safe to show as it is. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * The email as the account knows it: trimmed, Unicode-normalised (NFKC) and
 * lower-cased. Throws if it doesn't look like an email address.
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().normalize("NFKC").toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
    throw new AccountError("Enter a valid email address, like name@example.com");
  }
  return email;
}

/** True when `raw` is an acceptable email (after normalising). */
export function isEmail(raw: string): boolean {
  try {
    normalizeEmail(raw);
    return true;
  } catch {
    return false;
  }
}

/** Setup's own rule for the passphrase: the secret always has the email in it, so the vault can't enforce this. */
export function checkAccountPassphrase(passphrase: string): void {
  if ([...passphrase.normalize("NFKC")].length < MIN_PASSPHRASE) {
    throw new VaultError("WEAK_PASSPHRASE", `Use at least ${MIN_PASSPHRASE} characters`);
  }
}

/**
 * The vault id of one account: a hash of the role and the (already
 * normalised) email, so the id says nothing a stranger can read.
 */
export async function vaultIdFor(email: string, role: Role): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(`hewn:acct:v1:${role}:${email}`));
  return `acct-${digest.slice(0, 32)}`;
}

/**
 * What the vault key is wrapped with: the (already normalised) email and the
 * passphrase together. Pass this, not the bare passphrase, to
 * `createVault` and `unlockVault`.
 */
export function accountSecret(email: string, passphrase: string): string {
  return `hewn:v1\n${email}\n${passphrase.normalize("NFKC")}`;
}

/** An account that opened. The session holds its (non-extractable) data key. */
export type FoundAccount = { role: Role; session: VaultSession };

type Options = { iterations?: number };

/**
 * A failed login should take about as long as a real one, or the wait tells
 * a bystander which emails have an account here. One key derivation at the
 * same cost, thrown away.
 */
async function decoy(iterations: number): Promise<void> {
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey("raw", new TextEncoder().encode("decoy"), "PBKDF2", false, ["deriveBits"]);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
}

/**
 * Every account on this device that this email and passphrase open: none,
 * one, or two (the same email holding both a business and a worker account
 * under one passphrase). Throws `AccountError` with the generic message when
 * none opens; a damaged vault throws the vault's own error, since only the
 * right passphrase gets that far.
 */
export async function findAccounts(
  store: VaultStore,
  rawEmail: string,
  passphrase: string,
  { iterations = KDF_ITERATIONS }: Options = {},
): Promise<FoundAccount[]> {
  const email = normalizeEmail(rawEmail);
  const secret = accountSecret(email, passphrase);
  let tried = 0;
  const results = await Promise.all(
    ROLES.map(async (role): Promise<FoundAccount | null> => {
      const record = await store.load(await vaultIdFor(email, role));
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
