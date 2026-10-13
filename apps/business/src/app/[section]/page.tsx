import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SECTIONS, findSection } from "@/shell/sections";
import { SectionView } from "@/shell/SectionView";

type Params = { section: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return SECTIONS.map((s) => ({ section: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const section = findSection((await params).section);
  return { title: section ? `${section.label} · PNW Ledger` : "PNW Ledger" };
}

export default async function SectionPage({ params }: { params: Promise<Params> }) {
  const section = findSection((await params).section);
  if (!section) notFound();
  return <SectionView section={section} />;
}
