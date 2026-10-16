import { describe, expect, it } from "vitest";
import {
  addMembers,
  addOwnPost,
  addReceivedPost,
  applyChannelMessage,
  channelName,
  markPostsRead,
  markSeen,
  newChannel,
  postKind,
  postReceiptKind,
  removeMembers,
  skipPost,
  unreadPosts,
  validateBusinessChannel,
  validatePost,
  validateWorkChannel,
} from "./channels";

const PK = "ab".repeat(32);
const post = (n: number, epoch = 0, seq = n) => ({ version: 1 as const, id: n.toString(16).padStart(32, "0"), sentAt: `2026-10-16T1${n}:00:00.000Z`, text: `Post ${n}`, epoch, seq });

describe("a channel, the business's side", () => {
  it("starts with a random key, numbered 0, and the members picked", () => {
    const a = newChannel("  Everyone ", ["w1", "w2", "w1"]);
    const b = newChannel("Everyone", []);
    expect(a.name).toBe("Everyone");
    expect(a.members).toEqual(["w1", "w2"]);
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
    expect(a.key).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.epoch).toBe(0);
    expect(() => channelName(" ")).toThrow(/name/);
    expect(() => channelName("x".repeat(61))).toThrow(/60/);
  });

  it("moves to a new key when someone is taken out, and keeps it when someone is added", () => {
    const ch = newChannel("Everyone", ["w1", "w2"]);
    const after = removeMembers({ ...ch, nextOut: 3 }, ["w2"]);
    expect(after.members).toEqual(["w1"]);
    expect(after.epoch).toBe(1);
    expect(after.key).not.toBe(ch.key);
    expect(after.nextOut).toBe(0);
    expect(removeMembers(ch, ["nobody"])).toBe(ch);
    const added = addMembers(ch, ["w3", "w1"]);
    expect(added.members).toEqual(["w1", "w2", "w3"]);
    expect(added.key).toBe(ch.key);
  });

  it("keeps its posts and who has seen them, through a save", () => {
    let ch = newChannel("Everyone", ["w1", "w2"]);
    ch = addOwnPost(ch, post(1));
    expect(ch.nextOut).toBe(2);
    ch = markSeen(ch, 0, 1, "w1", "2026-10-16T20:00:00.000Z");
    expect(markSeen(ch, 0, 1, "w1", "2026-10-17T20:00:00.000Z")).toBe(ch);
    expect(markSeen(ch, 0, 9, "w1", "2026-10-17T20:00:00.000Z")).toBe(ch);
    expect(ch.posts[0]!.seenBy).toEqual({ w1: "2026-10-16T20:00:00.000Z" });
    expect(validateBusinessChannel(JSON.parse(JSON.stringify(ch)))).toEqual(ch);
    expect(() => validateBusinessChannel({ ...ch, key: "short" })).toThrow(/key/);
  });
});

describe("a channel, the person's side", () => {
  it("comes from the business's messages: added, given a new key, taken out, added back", () => {
    let chs = applyChannelMessage([], PK, { type: "channel", channelId: "c".repeat(16), name: "Everyone", epoch: 0, key: "1".repeat(64) });
    expect(chs[0]).toMatchObject({ name: "Everyone", keys: { 0: "1".repeat(64) }, nextIn: { 0: 0 } });
    chs = applyChannelMessage(chs, PK, { type: "channel", channelId: "c".repeat(16), name: "All hands", epoch: 1, key: "2".repeat(64) });
    expect(chs[0]).toMatchObject({ name: "All hands", keys: { 0: "1".repeat(64), 1: "2".repeat(64) } });
    chs = applyChannelMessage(chs, PK, { type: "channel_left", channelId: "c".repeat(16), name: "All hands" });
    expect(chs[0]!.left).toBe(true);
    chs = applyChannelMessage(chs, PK, { type: "channel", channelId: "c".repeat(16), name: "All hands", epoch: 2, key: "3".repeat(64) });
    expect(chs[0]!.left).toBeUndefined();
    // The same channel id from another business is another channel.
    expect(applyChannelMessage(chs, "cd".repeat(32), { type: "channel", channelId: "c".repeat(16), name: "Theirs", epoch: 0, key: "4".repeat(64) })).toHaveLength(2);
    expect(validateWorkChannel(JSON.parse(JSON.stringify(chs[0])))).toEqual(chs[0]);
  });

  it("keeps posts once, moves each key's slot, and counts what's unread", () => {
    let [ch] = applyChannelMessage([], PK, { type: "channel", channelId: "c".repeat(16), name: "Everyone", epoch: 0, key: "1".repeat(64) });
    ch = addReceivedPost(ch!, post(1, 0, 0));
    ch = addReceivedPost(ch, post(1, 0, 0));
    ch = skipPost(ch, 0, 4);
    expect(ch.posts).toHaveLength(1);
    expect(ch.nextIn[0]).toBe(5);
    expect(unreadPosts(ch)).toBe(1);
    const read = markPostsRead(ch);
    expect(unreadPosts(read)).toBe(0);
    expect(markPostsRead(read)).toBe(read);
  });
});

describe("posts", () => {
  it("are checked, and travel under kinds tied to the key and the channel", () => {
    expect(validatePost({ version: 1, id: "0".repeat(32), sentAt: "2026-10-16T10:00:00.000Z", text: "Hi" }).text).toBe("Hi");
    expect(() => validatePost({ version: 1, id: "0".repeat(32), sentAt: "2026-10-16T10:00:00.000Z", text: " " })).toThrow(/empty/);
    expect(() => validatePost({ version: 1, id: "0".repeat(32), sentAt: "2026-10-16T10:00:00.000Z", text: "x".repeat(4001) })).toThrow(/at most/);
    expect(() => validatePost({ version: 2, id: "0".repeat(32), sentAt: "2026-10-16T10:00:00.000Z", text: "Hi" })).toThrow(/version/);
    expect(postKind(3)).toBe("ann_3");
    expect(postReceiptKind("0123456789abcdef", 3)).toBe("ch_01234567_3");
  });
});
