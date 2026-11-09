import type { Metadata } from "next";
import { BRAND } from "@pnw/brand";
import { PAPER } from "@/paper/basement";

export const metadata: Metadata = {
  title: `${PAPER.title}: building ${BRAND.name}`,
  description: `${PAPER.subtitle}. ${PAPER.author}, ${PAPER.date}.`,
  alternates: { canonical: "/out-of-the-basement" },
  openGraph: {
    type: "article",
    title: PAPER.title,
    description: PAPER.subtitle,
    images: [{ url: BRAND.assets.heroJpg1536, width: 1536, height: 526, alt: `${BRAND.name}: ${BRAND.tagline}` }],
  },
};

const link = "font-medium text-foreground underline underline-offset-4 hover:text-primary";

// The paper's text is static, first-party HTML generated from its draft (src/paper/basement.ts):
// headings, paragraphs, quotes, lists, two inline SVG figures and two tables. No scripts.
export default function OutOfTheBasement() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="text-center">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{PAPER.version}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{PAPER.title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-muted-foreground">{PAPER.subtitle}</p>
        <p className="mt-5 text-base">
          {PAPER.author} · {PAPER.date}
        </p>
        <p className="mt-4 text-sm">
          <a href={PAPER.pdf} className={link} download>
            Download the PDF
          </a>
        </p>
      </header>

      <section aria-labelledby="abstract" className="mt-10 rounded-xl border bg-card p-6">
        <h2 id="abstract" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Abstract
        </h2>
        {PAPER.abstract.map((p) => (
          <p key={p.slice(0, 24)} className="mt-3 text-base leading-7" dangerouslySetInnerHTML={{ __html: p }} />
        ))}
        <p className="mt-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Keywords:</span> {PAPER.keywords}.
        </p>
      </section>

      <div className="paper mt-10" dangerouslySetInnerHTML={{ __html: PAPER.bodyHtml }} />
      <div className="paper mt-12" dangerouslySetInnerHTML={{ __html: PAPER.appendixHtml }} />

      <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
        <p>
          © 2026 {PAPER.author}. This paper is licensed under{" "}
          <a href={PAPER.licenceUrl} className={link}>
            {PAPER.licence}
          </a>
          : it may be shared with credit, not sold or altered. The code it describes is {BRAND.licence}, at{" "}
          <a href={BRAND.sourceUrl} className={link}>
            its source repository
          </a>
          .
        </p>
      </footer>
    </article>
  );
}
