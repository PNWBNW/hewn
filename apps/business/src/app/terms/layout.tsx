import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Terms of use · ${BRAND.name}`,
  description: `The terms for using ${BRAND.name}, free open-source bookkeeping and payroll, in its test release.`,
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
