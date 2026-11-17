// The top-page guard is wired into the app (docs/THREAT_MODEL.md T3): the stylesheet hides every
// page, the app's first client code shows it only as the top page, and the root layout carries
// the no-JavaScript note. The guard itself is tested in @pnw/security; in a real browser, framed
// and not, by test/frames (`pnpm --filter @pnw/business test:frames`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the top-page guard in the app", () => {
  it("hides every page from the app's stylesheet", () => {
    expect(read("app/globals.css").split("\n")).toContain(`@import "@pnw/security/frame_guard.css";`);
  });

  it("shows the page from the app's first client code, in both builds", () => {
    // `src/instrumentation-client.ts` is the name Next.js runs before hydration; it has no
    // `.server` part, so the static bundle (pageExtensions tsx, ts) runs it as the website does.
    const code = read("instrumentation-client.ts");
    expect(code).toContain('import { guardTopPage } from "@pnw/security/frame_guard";');
    expect(code).toMatch(/^guardTopPage\(window, document\.documentElement\);$/m);
  });

  it("gives people without JavaScript a note, first thing in the page", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/<html lang="en" suppressHydrationWarning>\s*<body[^>]*>\s*<noscript>/);
  });
});
