// An in-memory pin store for the mailbox function's tests: records every call.
import type { PinStore } from "./pinata";

/** An in-memory pin store that records every call. */
export function fakeStore(initial: Record<string, Uint8Array> = {}) {
  const pins = new Map<string, Uint8Array>(Object.entries(initial));
  const keep = new Map<string, string>();
  const calls: string[] = [];
  const cidOf = (name: string) => `cid-${name.slice(0, 8)}`;
  const store: PinStore = {
    async find(name) {
      calls.push(`find ${name}`);
      return pins.has(name) ? cidOf(name) : null;
    },
    async pin(name, bytes, keepUntil) {
      calls.push(keepUntil ? `pin ${name} ${bytes.length} until ${keepUntil}` : `pin ${name} ${bytes.length}`);
      pins.set(name, bytes);
      if (keepUntil) keep.set(name, keepUntil);
    },
    async expired(day, limit) {
      calls.push(`expired ${day} ${limit}`);
      return [...keep].filter(([name, d]) => d < day && pins.has(name)).slice(0, limit).map(([name]) => cidOf(name));
    },
    async fetch(cid) {
      calls.push(`fetch ${cid}`);
      for (const [name, bytes] of pins) if (cidOf(name) === cid) return bytes;
      return null;
    },
    async unpin(cid) {
      calls.push(`unpin ${cid}`);
      for (const name of [...pins.keys()]) if (cidOf(name) === cid) pins.delete(name);
    },
  };
  return { store, pins, keep, calls };
}
