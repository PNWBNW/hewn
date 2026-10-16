import { describe, expect, it } from "vitest";
import { packPayload, unpackPayload } from "./compress";

const text = (s: string) => new TextEncoder().encode(s);

describe("payload packing", () => {
  it("deflates what shrinks, and gets it back byte for byte", async () => {
    const doc = text(JSON.stringify({ letter: "Framing crew lead. Steel toes on site. ".repeat(200) }));
    const packed = await packPayload(doc);
    expect(packed[0]).toBe(0x01);
    expect(packed.length).toBeLessThan(doc.length / 5);
    expect(await unpackPayload(packed)).toEqual(doc);
  });

  it("leaves what wouldn't shrink as it is, and reads plain documents as they are", async () => {
    const tiny = text("{}");
    expect(await packPayload(tiny)).toEqual(tiny);
    expect(await unpackPayload(text('{"a":1}'))).toEqual(text('{"a":1}'));
  });

  it("refuses a marker with junk after it", async () => {
    await expect(unpackPayload(Uint8Array.from([0x01, 0xff, 0xff, 0xff]))).rejects.toThrow(/unpacked/);
  });
});
