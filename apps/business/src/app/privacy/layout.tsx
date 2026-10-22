import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: `Privacy · ${BRAND.name}`,
  description: `What ${BRAND.name} keeps, and where: your books stay encrypted on your device.`,
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
