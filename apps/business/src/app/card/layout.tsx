import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Cards · ${BRAND.name}`,
  description: `A business's or a person's card on ${BRAND.name}, drawn from their name: the name and the time on ${BRAND.name}, nothing else.`,
};

export default function CardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
