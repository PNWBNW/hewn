import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Job board · ${BRAND.name}`,
  description: `Jobs posted by businesses on ${BRAND.name}. Anyone can read them; applying is private.`,
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
