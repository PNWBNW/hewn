// The paper page carries the whole paper: every numbered section, both figures,
// both appendices, the PDF it links to, and no working notes left in the text.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAPER } from "./basement";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("the paper page", () => {
  it("has every numbered section and the references", () => {
    for (const heading of [
      "1. Introduction",
      "2. Who is writing",
      "3. What Hewn is",
      "4. Method",
      "5. The arc",
      "6. Findings",
      "7. Limitations and ethics",
      "8. Conclusion",
      "References",
    ]) {
      expect(PAPER.bodyHtml).toContain(heading);
    }
  });

  it("has both figures and both appendices", () => {
    expect(PAPER.bodyHtml.match(/<figure/g)?.length).toBe(2);
    expect(PAPER.appendixHtml).toContain("Appendix A.");
    expect(PAPER.appendixHtml).toContain("Appendix B.");
  });

  it("links a PDF that is served from this site", () => {
    const file = join(PUBLIC, PAPER.pdf);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(100_000);
  });

  it("carries no working notes, open questions or scripts", () => {
    const all = [...PAPER.abstract, PAPER.bodyHtml, PAPER.appendixHtml].join("\n");
    expect(all).not.toContain("[NOTE");
    expect(all).not.toContain("Open questions");
    expect(all).not.toMatch(/<script|javascript:|on[a-z]+=/i);
  });
});
