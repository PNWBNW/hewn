import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Check a proof · ${BRAND.name}`,
  description: `Check a period proof from ${BRAND.name} on your own device: that a closed range of the books is complete and unchanged, and that its fingerprint was anchored in public when it was closed. It doesn't check who anchored it.`,
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
