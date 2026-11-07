import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { CREDIT } from "@pnw/brand";
import { isPublicPath, redirectFor } from "@/shell/AppShell";
import { PrivacyPage } from "./privacy";
import { TermsPage } from "./terms";
import { FIGURES_NOTE, FiguresNote, LegalLinks } from "./LegalNotes";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'");

describe("terms and privacy", () => {
  it("are public: readable without an account, and never redirected", () => {
    for (const p of ["/terms", "/privacy"]) {
      expect(isPublicPath(p)).toBe(true);
      expect(redirectFor("business", p)).toBeNull();
      expect(redirectFor("worker", p)).toBeNull();
    }
    expect(isPublicPath("/termsheet")).toBe(false);
  });

  it("checking a proof is public too: an auditor needs no account", () => {
    expect(isPublicPath("/verify")).toBe(true);
    expect(redirectFor("business", "/verify")).toBeNull();
    expect(isPublicPath("/verifyx")).toBe(false);
  });

  it("name who runs it, the law, and where to write", () => {
    const terms = text(renderToStaticMarkup(createElement(TermsPage)));
    expect(terms).toContain(`${BRAND.name} is run by ${BRAND.operator}`);
    expect(terms).toContain("laws of the State of Washington");
    expect(terms).toContain("not tax, legal, accounting or financial advice");
    expect(terms).toContain(BRAND.supportEmail);
  });

  it("say what stays on the device, and nothing about the retired mailbox", () => {
    const privacy = text(renderToStaticMarkup(createElement(PrivacyPage)));
    expect(privacy).toContain(BRAND.supportEmail);
    expect(privacy.toLowerCase()).not.toContain("mailbox");
  });

  it("are linked from the small print, and the figures carry the note", () => {
    const links = renderToStaticMarkup(createElement(LegalLinks));
    expect(text(links)).toBe(`Testnet · provided as is · Terms · Privacy · ${CREDIT.text}`);
    expect(links).toContain('href="/terms"');
    expect(links).toContain('href="/privacy"');
    expect(links).toContain(`href="${CREDIT.url}"`);
    expect(text(renderToStaticMarkup(createElement(FiguresNote)))).toBe(FIGURES_NOTE);
  });

  it("carry the attribution the licence requires, word for word (LICENSING.md, AGPL section 7(b))", () => {
    expect(CREDIT.text).toBe("Hewn by Joshua Day");
    expect(CREDIT.url).toBe("https://github.com/PNWBNW/hewn");
    expect(CREDIT.copyright).toBe("© 2025-2026 Joshua Daniel Day");
  });
});
