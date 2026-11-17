import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRAND } from "@/brand";

// Where the page runs: the website (false) or the desktop app (true), as useDesktopApp reports it.
const where = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/desktop", () => ({ useDesktopApp: () => where.desktop }));

const { SHIELD_NOT_IN_DESKTOP, ShieldMissing } = await import("./ShieldStatus");

const html = (props: { website?: boolean }) =>
  renderToStaticMarkup(createElement(ShieldMissing, { className: "x", ...props, children: "Install the Shield extension." }));
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'");

describe("ShieldMissing", () => {
  it("keeps each screen's own words on the website", () => {
    where.desktop = false;
    expect(text(html({ website: true }))).toBe("Install the Shield extension.");
    expect(html({ website: true })).not.toContain(BRAND.appUrl);
  });

  it("says the desktop app can't reach Shield yet, instead of asking for the extension", () => {
    where.desktop = true;
    const plain = text(html({}));
    expect(plain).toBe(SHIELD_NOT_IN_DESKTOP);
    expect(plain).not.toContain("Install the Shield extension");
    // Where an account starts, it links to the website (the app opens it in the browser).
    const withLink = html({ website: true });
    expect(withLink).toContain(`href="${BRAND.appUrl}"`);
    expect(text(withLink)).toContain("Open the website");
    expect(html({})).not.toContain("href=");
  });
});
