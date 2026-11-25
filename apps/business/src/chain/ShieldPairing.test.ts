import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { encodeQr } from "@pnw/wallet/qr";
import { BRAND } from "@/brand";
import { PairingCode, ShieldPairingView, pairingSteps } from "./ShieldPairing";

const LINK = `https://connect.shield.app/connect#channelId=6f1c2a3b-0000-4000-8000-000000000001&pubkey=02${"a".repeat(64)}&relay=wss%3A%2F%2Frelay.shield.app&origin=https%3A%2F%2Fwww.hewnaccounting.com&secret=${"b".repeat(64)}&v=1`;
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
const view = (props: Partial<Parameters<typeof ShieldPairingView>[0]>) =>
  renderToStaticMarkup(createElement(ShieldPairingView, { connected: false, pairing: LINK, waiting: 0, shown: false, onShow: () => undefined, onCancel: () => undefined, ...props }));

describe("the pairing screen on a computer without the extension", () => {
  it("shows nothing when there is no code to show and nothing waiting", () => {
    expect(view({ pairing: null })).toBe("");
    expect(view({ connected: true, waiting: 0 })).toBe("");
  });

  it("asks for a tap before the code appears, and keeps the extension on offer", () => {
    const html = view({ shown: false });
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("secret");
    expect(text(html)).toContain("Show the code");
    expect(html).toContain('href="https://www.shield.app/"');
    expect(text(html)).toContain("Cancel");
  });

  it("draws the code after the tap, with the steps and the warning, and nowhere puts the link as text", () => {
    const html = view({ shown: true });
    expect(html).toContain("<svg");
    for (const step of pairingSteps("this site's address")) expect(text(html)).toContain(step);
    expect(text(html)).toContain("connects whoever opens it first");
    expect(text(html)).toContain("for 5 minutes");
    // The secret is only in the drawing: not as text, not in a link, not in an attribute.
    expect(html).not.toContain("b".repeat(64));
    expect(html).not.toContain("connect.shield.app");
  });

  it("names the address Shield will show, and says what an out-of-date Shield does", () => {
    const html = text(view({ shown: true, site: "www.hewnaccounting.com" }));
    expect(html).toContain(`names ${BRAND.name} and www.hewnaccounting.com`);
    expect(html).toContain("If the code opens a web page instead of Shield, update the Shield app");
  });

  it("says to open Shield on the phone while an approval is waiting, once paired", () => {
    const html = view({ connected: true, waiting: 1, pairing: null });
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("Open Shield on your phone to approve.");
    expect(html).not.toContain("<svg");
  });

  it("uses no inline style, script or remote image (the strict policy, docs/THREAT_MODEL.md T3)", () => {
    const html = view({ shown: true });
    expect(html).not.toMatch(/style=|<script|<img|<iframe|https?:\/\/(?!www\.shield\.app\/)/);
  });
});

describe("PairingCode", () => {
  it("draws exactly the encoder's modules, dark on white inside a four-module border", () => {
    const html = renderToStaticMarkup(createElement(PairingCode, { value: LINK }));
    const code = encodeQr(LINK, "M");
    const side = code.size + 8;
    expect(html).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(html).toContain('fill="#ffffff"');
    const d = html.match(/<path d="([^"]+)"/)![1]!;
    const drawn = new Set([...d.matchAll(/M(\d+),(\d+)h1v1h-1z/g)].map((m) => `${Number(m[1]) - 4},${Number(m[2]) - 4}`));
    const expected = new Set(code.modules.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`${x},${y}`] : []))));
    expect(drawn).toEqual(expected);
  });

  it("logs nothing while drawing", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    renderToStaticMarkup(createElement(PairingCode, { value: LINK }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
