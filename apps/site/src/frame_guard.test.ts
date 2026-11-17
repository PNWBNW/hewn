// The top-page guard is wired into the site as into the app (docs/THREAT_MODEL.md T3; why the
// site has it: README.md): the stylesheet hides the page, the site's first client code shows it
// only as the top page, and the root layout carries the no-JavaScript note.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

describe("the top-page guard in the site", () => {
  it("hides the page from the site's stylesheet", () => {
    expect(read("app/globals.css").split("\n")).toContain(`@import "@pnw/security/frame_guard.css";`);
  });

  it("shows the page from the site's first client code", () => {
    const code = read("instrumentation-client.ts");
    expect(code).toContain('import { guardTopPage } from "@pnw/security/frame_guard";');
    expect(code).toMatch(/^guardTopPage\(window, document\.documentElement\);$/m);
  });

  it("gives people without JavaScript a note, first thing in the page", () => {
    expect(read("app/layout.tsx")).toMatch(/<html lang="en" suppressHydrationWarning>\s*<body[^>]*>\s*<noscript>/);
  });
});
