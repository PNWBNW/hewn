// ---------------------------------------------------------------------------
// Group chats between coworkers (Joshua, 2026-10-16). There is no group key:
// every group message is sent to each member separately, through the
// private conversation the two coworkers already share (books/directory.ts),
// with the same message id everywhere. So nobody in a group can pass as
// someone else, the business can't read it, and taking someone out just
// means they get nothing new. It costs one send per member, so a group holds
// at most 25 people.
//
// A group is set up by its admin (`group`: name and members, sent to each of
// them, again whenever it changes). This module rebuilds each group from the
// person's coworker conversations: the latest setup that came from the admin
// themselves, every message from someone in it, and who has left. Pure.
// ---------------------------------------------------------------------------

import type { DirectoryEntry } from "./directory";
import type { ThreadItem } from "./thread";
import type { Work } from "./work";

export type GroupMessage = { id: string; sentAt: string; text: string; from: string; mine: boolean; read: boolean };

export type GroupView = {
  id: string;
  name: string;
  admin: string;
  /** Everyone in it now, by public key (left ones taken out). */
  members: DirectoryEntry[];
  messages: GroupMessage[];
  /** Whether this person is still in it. */
  joined: boolean;
  isAdmin: boolean;
  unread: number;
};

type Setup = { sentAt: string; name: string; admin: string; members: DirectoryEntry[] };

/** Every group this person is part of (or was) at one business, newest activity first. */
export function groupsFor(work: Work, businessKey: string): GroupView[] {
  const me = work.identities?.[businessKey]?.publicKey;
  if (!me) return [];
  const setups = new Map<string, Setup>();
  const texts = new Map<string, Map<string, GroupMessage>>();
  const left = new Map<string, Map<string, string>>(); // group → member → when they left

  for (const [theirKey, thread] of Object.entries(work.coworkers ?? {})) {
    if (thread.businessKey !== businessKey) continue;
    for (const item of thread.items as ThreadItem[]) {
      const b = item.body;
      const from = item.mine ? me : theirKey;
      if (b.type === "group") {
        // Only the admin sets a group up: their own copy, or one that came from them.
        if (b.admin !== from) continue;
        const prev = setups.get(b.groupId);
        if (!prev || prev.sentAt < item.sentAt) setups.set(b.groupId, { sentAt: item.sentAt, name: b.name, admin: b.admin, members: b.members });
      } else if (b.type === "group_text") {
        const msgs = texts.get(b.groupId) ?? new Map<string, GroupMessage>();
        const seen = msgs.get(item.id);
        // My message is in every member's conversation; read once is read everywhere.
        msgs.set(item.id, { id: item.id, sentAt: item.sentAt, text: b.text, from, mine: item.mine, read: item.mine || !!item.read || !!seen?.read });
        texts.set(b.groupId, msgs);
      } else if (b.type === "group_leave") {
        const l = left.get(b.groupId) ?? new Map<string, string>();
        const was = l.get(from);
        if (!was || was < item.sentAt) l.set(from, item.sentAt);
        left.set(b.groupId, l);
      }
    }
  }

  const out: GroupView[] = [];
  for (const [id, setup] of setups) {
    // Someone who left is out until the admin sets the group up with them again, after they left.
    const gone = left.get(id) ?? new Map<string, string>();
    const members = setup.members.filter((m) => !(gone.get(m.publicKey) && gone.get(m.publicKey)! > setup.sentAt));
    const keys = new Set(setup.members.map((m) => m.publicKey));
    // Messages from people in it, and not from after someone left.
    const messages = [...(texts.get(id)?.values() ?? [])].filter((m) => keys.has(m.from) && !(gone.get(m.from) && m.sentAt > gone.get(m.from)!)).sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : 1));
    const joined = members.some((m) => m.publicKey === me);
    out.push({ id, name: setup.name, admin: setup.admin, members, messages, joined, isAdmin: setup.admin === me, unread: messages.filter((m) => !m.read).length });
  }
  const latest = (g: GroupView) => g.messages.at(-1)?.sentAt ?? "";
  return out.sort((a, b) => latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name));
}

/** The ids of a group's messages, for marking them read in each conversation they came through. */
export const groupMessageIds = (g: GroupView): Set<string> => new Set(g.messages.filter((m) => !m.mine).map((m) => m.id));

/** A fresh group id. */
export const newGroupId = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
