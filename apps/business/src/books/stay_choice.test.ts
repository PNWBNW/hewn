// "Stay logged in" is a choice the person makes, never one made for them (Joshua, 2026-11-11):
// every screen that opens books shows the same tick box, unticked, and says what ticking it does.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormError } from "./AuthCard";
import { STAY_NOTE, STILL_REMEMBERED_NOTE, StayChoice } from "./StayChoice";

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

  it("Log out waits for the device to forget the login, and the front page says when it couldn't", () => {
    const provider = read("books/BooksProvider.tsx");
    const lock = provider.slice(provider.indexOf("const lock = useCallback("), provider.indexOf("// Updates run one at a time"));
    // The delete is started, its outcome awaited and kept: never fired and left.
    expect(lock).toContain("const gone = withinTime(forgetSession(store), STARTUP_WAIT_MS).catch(() => false);");
    expect(lock).toContain("const forgotten = await gone;");
    expect(lock).toContain("setStillRemembered(!forgotten)");
    expect(provider).not.toMatch(/void forgetSession/);
    // The key and the books leave memory before the wait, not after it.
    expect(lock.indexOf("session.current?.lock();")).toBeGreaterThan(0);
    expect(lock.indexOf("session.current?.lock();")).toBeLessThan(lock.indexOf("await gone"));
    // A new login waits for a Log out still under way, and clears what it said.
    const open = provider.slice(provider.indexOf("const open = useCallback("), provider.indexOf("// On load: reopen books kept open"));
    expect(open.indexOf("await forgetting.current;")).toBeGreaterThan(0);
    expect(open.indexOf("await forgetting.current;")).toBeLessThan(open.indexOf("s.remember(store, until)"));

    expect(read("books/BooksGate.tsx")).toContain("stillRemembered={stillRemembered}");
    expect(read("books/FrontPage.tsx")).toContain("{stillRemembered && (");
    expect(read("books/FrontPage.tsx")).toContain("<FormError message={STILL_REMEMBERED_NOTE} />");
    const html = renderToStaticMarkup(createElement(FormError, { message: STILL_REMEMBERED_NOTE }));
    expect(html).toContain('role="alert"');
    expect(STILL_REMEMBERED_NOTE).toMatch(/couldn't make this device forget your login/);
    expect(STILL_REMEMBERED_NOTE).toMatch(/without your passphrase/);
    expect(STILL_REMEMBERED_NOTE).toMatch(/clear this site's data/);
  });
});
