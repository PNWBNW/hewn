// "Stay logged in" is a choice the person makes, never one made for them (Joshua, 2026-11-11):
// every screen that opens books shows the same tick box, unticked, and says what ticking it does.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STAY_NOTE, StayChoice } from "./StayChoice";

const SRC = join(__dirname, "..");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("stay logged in", () => {
  it("is shown unticked, with what it does", () => {
    const html = renderToStaticMarkup(createElement(StayChoice, { checked: false, onChange: () => {} }));
    expect(html).toContain("Stay logged in on this device for 24 hours");
    expect(html).not.toMatch(/checked/);
    expect(STAY_NOTE).toMatch(/without your passphrase/);
    expect(STAY_NOTE).toMatch(/copy its browser data/);
    expect(STAY_NOTE).toMatch(/shared device/);
  });

  it("is asked on every screen that opens books, and starts unticked on each", () => {
    for (const file of ["books/LoginDialog.tsx", "books/SetupScreen.tsx", "books/RestoreScreen.tsx", "chain/ChainRestore.tsx"]) {
      const text = read(file);
      expect(text, file).toContain("<StayChoice checked={stay} onChange={setStay} />");
      expect(text, file).toContain("const [stay, setStay] = useState(false);");
    }
  });

  it("is never switched on by a default in the provider", () => {
    const text = read("books/BooksProvider.tsx");
    expect(text).not.toMatch(/stay = true/);
    expect(text.match(/stay = false/g)?.length).toBe(7);
    expect(text).toContain("const stayChoice = useRef(false);");
  });
});
