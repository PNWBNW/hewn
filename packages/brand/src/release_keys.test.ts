import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RELEASE_KEY_FIXTURE, releaseKeys, type ReleaseKey } from "./index";

// The release keys (scripts/release/README.md): each id must be the one its key gives, or
// verify.mjs refuses the list, and the tests' fixture key must never be trusted.

const idOf = (key: ReleaseKey) => createHash("sha256").update(Buffer.from(key.publicKey, "base64")).digest("hex").slice(0, 16);

function wellFormed(key: ReleaseKey) {
  const raw = Buffer.from(key.publicKey, "base64");
  expect(raw.length).toBe(32);
  expect(raw.toString("base64")).toBe(key.publicKey);
  expect(key.id).toMatch(/^[0-9a-f]{16}$/);
  expect(key.id).toBe(idOf(key));
}

describe("release keys", () => {
  it("each published key is 32 bytes in base64, under its own id, listed once", () => {
    releaseKeys.forEach(wellFormed);
    expect(new Set(releaseKeys.map((k) => k.id)).size).toBe(releaseKeys.length);
  });

  it("the fixture key is well formed and never among the trusted keys", () => {
    wellFormed(RELEASE_KEY_FIXTURE);
    expect(releaseKeys.map((k) => k.publicKey)).not.toContain(RELEASE_KEY_FIXTURE.publicKey);
  });
});
