import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Traction · ${BRAND.name}`,
  description: `Where people have opened ${BRAND.name} since launch, by country. Totals only, nothing about anyone.`,
};

export default function TractionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
