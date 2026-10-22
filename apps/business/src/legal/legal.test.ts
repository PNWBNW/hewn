import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
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
    expect(text(links)).toBe("Testnet · provided as is · Terms · Privacy");
    expect(links).toContain('href="/terms"');
    expect(links).toContain('href="/privacy"');
    expect(text(renderToStaticMarkup(createElement(FiguresNote)))).toBe(FIGURES_NOTE);
  });
});
