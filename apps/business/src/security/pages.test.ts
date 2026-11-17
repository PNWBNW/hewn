import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { pagesPlan } from "./pages";

describe("serving the static bundle from GitHub Pages", () => {
  it("names the app's own domain in the CNAME file", () => {
    expect(pagesPlan({ appUrl: "https://www.example.com", counterUrl: "https://count.example.com" })).toEqual({ cname: "www.example.com", warnings: [] });
  });

  it("never serves the app from the shared github.io origin, or from anything but a bare https domain", () => {
    for (const appUrl of [
      "https://pnwbnw.github.io",
      "https://pnwbnw.github.io/hewn",
      "https://github.io",
      "https://x.githubusercontent.com",
      "http://www.example.com",
      "https://www.example.com:8443",
      "https://www.example.com/app",
      "https://localhost",
      "https://127.0.0.1",
    ]) {
      expect(() => pagesPlan({ appUrl, counterUrl: "https://count.example.com" }), appUrl).toThrow();
    }
  });

  it("warns, without failing, while the counter still shares the app's address", () => {
    const plan = pagesPlan({ appUrl: "https://www.example.com", counterUrl: "https://www.example.com" });
    expect(plan.cname).toBe("www.example.com");
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/counter/);
  });

  it("accepts today's brand", () => {
    expect(pagesPlan(BRAND).cname).toBe(new URL(BRAND.appUrl).hostname);
  });
});
