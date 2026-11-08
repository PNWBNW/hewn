import { describe, expect, it } from "vitest";
import { type SaveEnv, pickerAccept, saveFile, shareFailure, sharedName } from "./save_file";

/** A browser with a share sheet that answers as told, recording what it was handed. */
function env(over: Partial<SaveEnv> & { refuse?: unknown } = {}) {
  const shared: File[] = [];
  const downloaded: File[] = [];
  const e: SaveEnv = {
    touch: true,
    canShare: () => true,
    share: async (file) => {
      if (over.refuse !== undefined) throw over.refuse;
      shared.push(file);
    },
    download: (file) => void downloaded.push(file),
    ...over,
  };
  return { env: e, shared, downloaded };
}

describe("saveFile", () => {
  it("shares on a phone, as plain text under a .txt name, the contents unchanged", async () => {
    const b = env();
    expect(await saveFile('{"a":1}', "books-2026-11-08.hewn", "application/json", b.env)).toBe("shared");
    expect(b.shared).toHaveLength(1);
    expect(b.shared[0]!.name).toBe("books-2026-11-08.hewn.txt");
    expect(b.shared[0]!.type).toBe("text/plain");
    expect(await b.shared[0]!.text()).toBe('{"a":1}');
    expect(b.downloaded).toEqual([]);
  });

  it("downloads under the file's own name when the browser refuses the share (Brave on Android, 2026-11-08)", async () => {
    const b = env({ refuse: new DOMException("Permission denied", "NotAllowedError") });
    expect(await saveFile("x", "books.hewn", "application/json", b.env)).toBe("downloaded");
    expect(b.downloaded.map((f) => [f.name, f.type])).toEqual([["books.hewn", "application/json"]]);
  });

  it("is cancelled when the person closes the share sheet, and nothing is downloaded", async () => {
    const b = env({ refuse: new DOMException("Share canceled", "AbortError") });
    expect(await saveFile("x", "books.hewn", "application/json", b.env)).toBe("cancelled");
    expect(b.downloaded).toEqual([]);
  });

  it("passes on an error it doesn't know", async () => {
    const b = env({ refuse: new Error("disk full") });
    await expect(saveFile("x", "books.hewn", "application/json", b.env)).rejects.toThrow("disk full");
  });

  it("downloads where there is no share sheet: a computer, or a browser that can't share files", async () => {
    const desktop = env({ touch: false });
    expect(await saveFile("x", "proof.json", "application/json", desktop.env)).toBe("downloaded");
    expect(desktop.shared).toEqual([]);
    const noFiles = env({ canShare: () => false });
    expect(await saveFile("x", "proof.json", "application/json", noFiles.env)).toBe("downloaded");
    expect(noFiles.downloaded[0]!.name).toBe("proof.json");
  });
});

describe("the share sheet's terms", () => {
  it("adds .txt once", () => {
    expect(sharedName("a.hewn")).toBe("a.hewn.txt");
    expect(sharedName("proof.json")).toBe("proof.json.txt");
    expect(sharedName("notes.TXT")).toBe("notes.TXT");
  });

  it("tells a closed sheet from a refused file", () => {
    expect(shareFailure(new DOMException("", "AbortError"))).toBe("cancelled");
    expect(shareFailure(new DOMException("Permission denied", "NotAllowedError"))).toBe("download");
    expect(shareFailure(new TypeError("bad data"))).toBe("download");
    expect(shareFailure(new Error("other"))).toBe("throw");
  });

  it("lets the pickers take the .txt a share sheet saved", () => {
    expect(pickerAccept("hewn")).toBe(".hewn,application/json,.txt,text/plain");
    expect(pickerAccept("json")).toBe(".json,application/json,.txt,text/plain");
  });
});
