import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SECTIONS, findSection } from "@/shell/sections";
import { SectionView } from "@/shell/SectionView";

type Params = { section: string };

export const dynamicParams = false;

// Sections with their own working screens (src/app/<id>/) are routed there instead.
const OWN_ROUTES = new Set(["transactions"]);

export function generateStaticParams(): Params[] {
  return SECTIONS.filter((s) => !OWN_ROUTES.has(s.id)).map((s) => ({ section: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const section = findSection((await params).section);
  return { title: section ? `${section.label} · Plumb` : "Plumb" };
}

export default async function SectionPage({ params }: { params: Promise<Params> }) {
  const section = findSection((await params).section);
  if (!section || OWN_ROUTES.has(section.id)) notFound();
  return <SectionView section={section} />;
}
