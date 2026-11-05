import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Check a proof · ${BRAND.name}`,
  description: `Check a period proof from ${BRAND.name} on your own device: that a closed range of the books is complete and unchanged, and anchored in public when it was closed.`,
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
