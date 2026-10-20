// ---------------------------------------------------------------------------
// Announcement channels (Joshua, 2026-10-16): the business posts once and
// everyone in the channel reads it. "Everyone", "Night crew", whatever the
// business makes.
//
// Each channel has its own random 32-byte key, numbered (`epoch`). The
// business sends it to each member privately, as a `channel` message in that
// person's thread (books/thread.ts). Posts are sealed once with the channel's
// key, into numbered slots only the business writes. When someone leaves,
// the channel moves to a new key and the members who stay get it, so the one
// who left can't read what comes next. Each reader's app sends a receipt
// through their own thread, so the business sees who has seen each post.
//
// Pure: no I/O, no React. The mailbox side is chain/channels.ts.
// ---------------------------------------------------------------------------

import { type TeamPart, validateTeamPart } from "./team_schedule";

export const MAX_POST_CHARS = 4_000;
export const MAX_CHANNEL_NAME = 60;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_SEQ = 0xffff_ffff;

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelError";
  }
}

/** What a post says, as sealed. A post in a "Team schedule" channel also carries part of a published week (books/team_schedule.ts). */
export type ChannelPost = { version: 1; id: string; sentAt: string; text: string; schedule?: TeamPart };

/** A post as a vault keeps it: under which key and in which slot it went. */
export type PostItem = ChannelPost & {
  epoch: number;
  seq: number;
  /** The person's side: when this device got it, and whether it's been seen here. */
  receivedAt?: string;
  read?: true;
  /** The business's side: who has seen it, by team member id → when (from their receipts). */
  seenBy?: Record<string, string>;
};

/** A channel as the business keeps it. */
export type BusinessChannel = {
  id: string;
  name: string;
  createdAt: string;
  /** The current key and its number. */
  epoch: number;
  key: string;
  /** Team member ids. */
  members: string[];
  /** The next unused post slot under the current key. */
  nextOut: number;
  posts: PostItem[];
};

/** A channel as the person keeps it: one business's, opened with the keys it was given. */
export type WorkChannel = {
  id: string;
  name: string;
  /** The thread it came through: the business's parties key with this person. */
  partiesKey: string;
  /** Every key it was given, by number, so posts from before a change still open. */
  keys: Record<string, string>;
  /** The next unread post slot under each key. */
  nextIn: Record<string, number>;
  posts: PostItem[];
  /** Taken out of the channel: nothing new arrives. */
  left?: true;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SEQ;
const isEpoch = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999_999;

/** A fresh random id (8 bytes) or key (32 bytes), hex. */
export function randomHex(bytes: number): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The mailbox kind posts under key `epoch` travel in (sealed with the channel key, so it never meets another channel's). */
export const postKind = (epoch: number): string => `ann_${epoch}`;

/** The kind a reader's receipt for a post is addressed by, under their own parties key. */
export const postReceiptKind = (channelId: string, epoch: number): string => `ch_${channelId.slice(0, 8)}_${epoch}`;

export function channelName(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ChannelError("Give the channel a name");
  const name = raw.trim();
  if ([...name].length > MAX_CHANNEL_NAME) throw new ChannelError(`A channel name is at most ${MAX_CHANNEL_NAME} characters`);
  return name;
}

/** Checks a post that arrived: every field in shape. */
export function validatePost(raw: unknown): ChannelPost {
  if (!isObject(raw)) throw new ChannelError("A post must be an object");
  if (raw.version !== 1) throw new ChannelError("Unknown post version");
  if (typeof raw.id !== "string" || !/^[0-9a-f]{32}$/.test(raw.id)) throw new ChannelError("A post needs an id");
  if (!isStamp(raw.sentAt)) throw new ChannelError("A post needs the time it was sent");
  if (typeof raw.text !== "string" || !raw.text.trim()) throw new ChannelError("A post can't be empty");
  if ([...raw.text].length > MAX_POST_CHARS) throw new ChannelError(`A post can be at most ${MAX_POST_CHARS.toLocaleString("en-US")} characters`);
  const post: ChannelPost = { version: 1, id: raw.id, sentAt: raw.sentAt, text: raw.text };
  if (raw.schedule !== undefined) {
    try {
      post.schedule = validateTeamPart(raw.schedule);
    } catch (e) {
      throw new ChannelError(e instanceof Error ? e.message : "The schedule in the post isn't valid");
    }
  }
  return post;
}

function validatePostItem(raw: unknown): PostItem {
  const post = validatePost(raw);
  const r = raw as Record<string, unknown>;
  if (!isEpoch(r.epoch) || !isSeq(r.seq)) throw new ChannelError("A post needs its key number and slot");
  const item: PostItem = { ...post, epoch: r.epoch, seq: r.seq };
  if (r.receivedAt !== undefined) {
    if (!isStamp(r.receivedAt)) throw new ChannelError("A post's arrival isn't a time");
    item.receivedAt = r.receivedAt;
  }
  if (r.read !== undefined) {
    if (r.read !== true) throw new ChannelError("Read must be true");
    item.read = true;
  }
  if (r.seenBy !== undefined) {
    if (!isObject(r.seenBy) || !Object.values(r.seenBy).every(isStamp)) throw new ChannelError("Seen-by must map team members to times");
    item.seenBy = { ...(r.seenBy as Record<string, string>) };
  }
  return item;
}

const byTime = (a: PostItem, b: PostItem) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : 1);

function posts(raw: unknown): PostItem[] {
  if (!Array.isArray(raw)) throw new ChannelError("A channel's posts must be a list");
  const byId = new Map<string, PostItem>();
  for (const p of raw.map(validatePostItem)) byId.set(p.id, p);
  return [...byId.values()].sort(byTime);
}

export function validateBusinessChannel(raw: unknown): BusinessChannel {
  if (!isObject(raw)) throw new ChannelError("A channel must be an object");
  if (typeof raw.id !== "string" || !HEX16.test(raw.id)) throw new ChannelError("A channel needs its id");
  if (!isStamp(raw.createdAt)) throw new ChannelError("A channel needs the time it was made");
  if (!isEpoch(raw.epoch) || typeof raw.key !== "string" || !HEX64.test(raw.key)) throw new ChannelError("A channel needs its key");
  if (!Array.isArray(raw.members) || !raw.members.every((m) => typeof m === "string" && m)) throw new ChannelError("A channel's members must be team member ids");
  if (!isSeq(raw.nextOut)) throw new ChannelError("A channel's next slot must be a whole number");
  return { id: raw.id, name: channelName(raw.name), createdAt: raw.createdAt, epoch: raw.epoch, key: raw.key, members: [...new Set(raw.members as string[])], nextOut: raw.nextOut, posts: posts(raw.posts) };
}

export function validateWorkChannel(raw: unknown): WorkChannel {
  if (!isObject(raw)) throw new ChannelError("A channel must be an object");
  if (typeof raw.id !== "string" || !HEX16.test(raw.id)) throw new ChannelError("A channel needs its id");
  if (typeof raw.partiesKey !== "string" || !HEX64.test(raw.partiesKey)) throw new ChannelError("A channel needs the thread it came through");
  if (!isObject(raw.keys) || !Object.entries(raw.keys).every(([e, k]) => isEpoch(Number(e)) && typeof k === "string" && HEX64.test(k))) throw new ChannelError("A channel's keys aren't valid");
  if (!isObject(raw.nextIn) || !Object.entries(raw.nextIn).every(([e, n]) => isEpoch(Number(e)) && isSeq(n))) throw new ChannelError("A channel's slots aren't valid");
  const ch: WorkChannel = {
    id: raw.id,
    name: channelName(raw.name),
    partiesKey: raw.partiesKey,
    keys: { ...(raw.keys as Record<string, string>) },
    nextIn: { ...(raw.nextIn as Record<string, number>) },
    posts: posts(raw.posts),
  };
  if (raw.left !== undefined) {
    if (raw.left !== true) throw new ChannelError("Left must be true");
    ch.left = true;
  }
  return ch;
}

// ---- The business's side ----------------------------------------------------

/** A new channel, with its first key. Nobody has the key until it's sent to them. */
export function newChannel(name: string, members: readonly string[], now: Date = new Date()): BusinessChannel {
  return { id: randomHex(8), name: channelName(name), createdAt: now.toISOString(), epoch: 0, key: randomHex(32), members: [...new Set(members)], nextOut: 0, posts: [] };
}

/** Takes members out: the channel moves to a new key, which only the ones who stay will get. */
export function removeMembers(ch: BusinessChannel, gone: readonly string[]): BusinessChannel {
  const members = ch.members.filter((m) => !gone.includes(m));
  if (members.length === ch.members.length) return ch;
  return { ...ch, members, epoch: ch.epoch + 1, key: randomHex(32), nextOut: 0 };
}

/** Adds members; they get the current key (and so the posts already sealed with it). */
export const addMembers = (ch: BusinessChannel, added: readonly string[]): BusinessChannel => ({ ...ch, members: [...new Set([...ch.members, ...added])] });

/** Keeps a post this business sent, and moves the slot past it. */
export function addOwnPost(ch: BusinessChannel, item: PostItem): BusinessChannel {
  const fresh = validatePostItem(item);
  return { ...ch, posts: [...ch.posts.filter((p) => p.id !== fresh.id), fresh].sort(byTime), nextOut: fresh.epoch === ch.epoch ? Math.max(ch.nextOut, fresh.seq + 1) : ch.nextOut };
}

/** Records that `workerId` has seen the post in slot `seq` under key `epoch`. The first time sticks. */
export function markSeen(ch: BusinessChannel, epoch: number, seq: number, workerId: string, at: string): BusinessChannel {
  if (!isStamp(at)) throw new ChannelError("A receipt needs a time");
  const post = ch.posts.find((p) => p.epoch === epoch && p.seq === seq);
  if (!post || post.seenBy?.[workerId]) return ch;
  return { ...ch, posts: ch.posts.map((p) => (p === post ? { ...p, seenBy: { ...p.seenBy, [workerId]: at } } : p)) };
}

// ---- The person's side ------------------------------------------------------

/** Applies a `channel` or `channel_left` message from the business (through `partiesKey`) to the person's channels. */
export function applyChannelMessage(
  channels: readonly WorkChannel[],
  partiesKey: string,
  body: { type: "channel"; channelId: string; name: string; epoch: number; key: string } | { type: "channel_left"; channelId: string; name: string },
): WorkChannel[] {
  const current = channels.find((c) => c.id === body.channelId && c.partiesKey === partiesKey);
  const others = channels.filter((c) => c !== current);
  if (body.type === "channel_left") return current ? [...others, { ...current, left: true }] : [...channels];
  const base: WorkChannel = current ?? { id: body.channelId, name: body.name, partiesKey, keys: {}, nextIn: {}, posts: [] };
  const { left: _left, ...rest } = base;
  return [...others, { ...rest, name: body.name, keys: { ...base.keys, [body.epoch]: body.key }, nextIn: { [body.epoch]: 0, ...base.nextIn } }];
}

/** Keeps a post that arrived, and moves its key's slot past it. */
export function addReceivedPost(ch: WorkChannel, item: PostItem): WorkChannel {
  const fresh = validatePostItem(item);
  const e = String(fresh.epoch);
  return { ...ch, posts: [...ch.posts.filter((p) => p.id !== fresh.id), fresh].sort(byTime), nextIn: { ...ch.nextIn, [e]: Math.max(ch.nextIn[e] ?? 0, fresh.seq + 1) } };
}

/** Moves past a slot that couldn't be read. */
export const skipPost = (ch: WorkChannel, epoch: number, seq: number): WorkChannel => ({ ...ch, nextIn: { ...ch.nextIn, [epoch]: Math.max(ch.nextIn[epoch] ?? 0, seq + 1) } });

export const unreadPosts = (ch: WorkChannel | undefined): number => ch?.posts.filter((p) => !p.read).length ?? 0;

export function markPostsRead(ch: WorkChannel): WorkChannel {
  if (!ch.posts.some((p) => !p.read)) return ch;
  return { ...ch, posts: ch.posts.map((p) => (p.read ? p : { ...p, read: true as const })) };
}
