import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { DESKTOP_ORIGINS, isDesktopApp, mayRegisterServiceWorker } from "./desktop";

const at = (url: string) => {
  const u = new URL(url);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port };
};

describe("isDesktopApp", () => {
  it("knows the desktop app's origin on every platform", () => {
    for (const origin of DESKTOP_ORIGINS) expect(isDesktopApp(at(`${origin}/settings/`))).toBe(true);
    expect(isDesktopApp(at("tauri://localhost/"))).toBe(true); // macOS, Linux
    expect(isDesktopApp(at("https://tauri.localhost/"))).toBe(true); // Windows
  });

  it("is false on the website, a local server and a page with no address", () => {
    expect(isDesktopApp(at(BRAND.appUrl))).toBe(false);
    expect(isDesktopApp(at("http://localhost:3000/"))).toBe(false);
    expect(isDesktopApp(at("http://tauri.localhost:3000/"))).toBe(false);
    expect(isDesktopApp(at("https://tauri.localhost.example.com/"))).toBe(false);
    expect(isDesktopApp(at("tauri://elsewhere/"))).toBe(false);
    expect(isDesktopApp(undefined)).toBe(false);
  });

  it("is false where the tests run (no page)", () => {
    expect(isDesktopApp()).toBe(false);
  });
});

describe("mayRegisterServiceWorker", () => {
  const browser = { serviceWorker: {} };
  it("never inside the desktop app, even where the engine has workers", () => {
    for (const origin of DESKTOP_ORIGINS) expect(mayRegisterServiceWorker(at(`${origin}/`), browser)).toBe(false);
  });

  it("on the website when the browser has workers, not when it hasn't", () => {
    expect(mayRegisterServiceWorker(at(BRAND.appUrl), browser)).toBe(true);
    expect(mayRegisterServiceWorker(at(BRAND.appUrl), {})).toBe(false);
    expect(mayRegisterServiceWorker(at(BRAND.appUrl), undefined)).toBe(false);
  });
});
