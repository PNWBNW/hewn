// ---------------------------------------------------------------------------
// Backups of a business ↔ team member conversation on chain, only when both
// agree (Joshua, 2026-10-23; docs/TWIN_CURVE_CONVERSATIONS.md, "Backups, by
// agreement"). Either side asks (`backup_request`); the other answers Allow
// or Decline (`backup_answer`). On Allow each side writes its own copy: a
// letter to its own account holding the conversation's keys up to that
// point, sealed with a key from its username and passphrase
// (chain/conversation_backup.ts). Then the keys refresh (books/key_ring.ts
// `noteBackup`): the side that allowed starts fresh ones, its half riding on
// the Allow, so the copy covers the conversation only up to there.
//
// Pure: what a backup holds, and where each request stands.
// ---------------------------------------------------------------------------

import { backedUp } from "./key_ring";
import type { Side, Thread } from "./thread";

export type ConversationBackup = {
  version: 1;
  kind: "conversation_backup";
  /** The conversation: the agreement's parties key, this account's side, and the other side's account. */
  partiesKey: string;
  side: Side;
  peer: string;
  /** The keys of the pairs it covers, newest first; the agreement's own key is `partiesKey`. */
  keys: string[];
  requestId: string;
  madeAt: string;
};

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_KEYS = 32;

export function validateConversationBackup(raw: unknown): ConversationBackup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BackupError("A backup must be an object");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || r.kind !== "conversation_backup") throw new BackupError("That isn't a conversation backup");
  if (typeof r.partiesKey !== "string" || !HEX64.test(r.partiesKey)) throw new BackupError("A backup names its conversation");
  if (r.side !== "business" && r.side !== "worker") throw new BackupError("A backup names its side");
  if (typeof r.peer !== "string" || !/^aleo1[a-z0-9]{58}$/.test(r.peer)) throw new BackupError("A backup names the other side's account");
  if (!Array.isArray(r.keys) || r.keys.length > MAX_KEYS || !r.keys.every((k) => typeof k === "string" && HEX64.test(k))) throw new BackupError("A backup's keys must be keys");
  if (typeof r.requestId !== "string" || !/^[0-9a-f]{32}$/.test(r.requestId)) throw new BackupError("A backup names the request both agreed to");
  if (typeof r.madeAt !== "string" || Number.isNaN(Date.parse(r.madeAt))) throw new BackupError("A backup needs the time it was made");
  return { version: 1, kind: "conversation_backup", partiesKey: r.partiesKey, side: r.side, peer: r.peer, keys: [...r.keys] as string[], requestId: r.requestId, madeAt: r.madeAt };
}

/** One request to back the conversation up, as this side sees it. */
export type BackupRequest = {
  requestId: string;
  /** This side asked. */
  mine: boolean;
  askedAt: string;
  /** The answer, and when this side saw it (sent, or received). */
  answer?: { allow: boolean; mine: boolean; at: string };
  /** This side made its copy. */
  copied: boolean;
};

/** Every backup request in the conversation, oldest first. */
export function backupRequests(thread: Thread | undefined): BackupRequest[] {
  const out: BackupRequest[] = [];
  for (const item of thread?.items ?? []) {
    if (item.body.type === "backup_request") {
      out.push({ requestId: item.body.requestId, mine: item.mine, askedAt: item.sentAt, copied: backedUp(thread?.ring, item.body.requestId) });
    }
  }
  for (const item of thread?.items ?? []) {
    if (item.body.type !== "backup_answer") continue;
    const request = out.find((r) => r.requestId === (item.body as { requestId: string }).requestId);
    // Only the side that didn't ask answers, and only the first answer counts.
    if (!request || request.answer || request.mine === item.mine) continue;
    request.answer = { allow: item.body.allow, mine: item.mine, at: item.mine ? item.sentAt : (item.receivedAt ?? item.sentAt) };
  }
  return out;
}

/** What a request needs from this side now. */
export type BackupStep = "answer" | "waiting" | "copy" | "done" | "declined";

export function backupStep(r: BackupRequest): BackupStep {
  if (!r.answer) return r.mine ? "waiting" : "answer";
  if (!r.answer.allow) return "declined";
  return r.copied ? "done" : "copy";
}

/** A new request can be made when none is waiting for an answer. */
export const canAskBackup = (thread: Thread | undefined): boolean => !backupRequests(thread).some((r) => !r.answer);
