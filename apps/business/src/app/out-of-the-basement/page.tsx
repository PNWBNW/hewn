import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { PAPER } from "@/paper/basement";
import "@/paper/paper.css";

// The app sets no metadataBase, so the addresses a link preview needs are written out in full.
const URL_HERE = `${BRAND.appUrl}/out-of-the-basement`;

export const metadata: Metadata = {
  title: `${PAPER.title}: building ${BRAND.name}`,
  description: `${PAPER.subtitle}. ${PAPER.author}, ${PAPER.date}.`,
  alternates: { canonical: URL_HERE },
  openGraph: {
    type: "article",
    url: URL_HERE,
    title: PAPER.title,
    description: PAPER.subtitle,
    images: [{ url: `${BRAND.appUrl}${BRAND.assets.heroJpg1536}`, width: 1536, height: 526, alt: `${BRAND.name}: ${BRAND.tagline}` }],
  },
};

// Joshua's paper on how Hewn was built, readable without an account (shell/AppShell.tsx isPublicPath)
// and linked from the front page. Laid out like a journal article: a white sheet, serif type, a
// centred title block, a set-off abstract, justified text with indented paragraphs (paper/paper.css).
// The text is static, first-party HTML generated from the paper's draft (paper/basement.ts):
// headings, paragraphs, quotes, lists, two inline SVG figures and two tables. No scripts.
export default function OutOfTheBasement() {
  return (
    <div className="paper-desk">
      <article className="paper-sheet">
        <p className="paper-running">
          <span>{PAPER.version}</span>
          <span>{PAPER.date}</span>
        </p>

        <header className="paper-titleblock">
          <h1>{PAPER.title}</h1>
          <p className="paper-subtitle">{PAPER.subtitle}</p>
          <p className="paper-author">{PAPER.author}</p>
          <p className="paper-affil">Independent; {BRAND.name}, {BRAND.siteUrl.replace(/^https?:\/\//, "")}</p>
          <p className="paper-pdf">
            <a href={PAPER.pdf} download>
              PDF
            </a>
          </p>
        </header>

        <section aria-labelledby="abstract" className="paper-abstract">
          <h2 id="abstract">Abstract</h2>
          {PAPER.abstract.map((p) => (
            <p key={p.slice(0, 24)} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
          <p className="paper-keywords">
            <em>Keywords:</em> {PAPER.keywords}.
          </p>
        </section>

        <div className="paper" dangerouslySetInnerHTML={{ __html: PAPER.bodyHtml }} />
        <div className="paper paper-appendix" dangerouslySetInnerHTML={{ __html: PAPER.appendixHtml }} />

        <footer className="paper-colophon">
          © 2026 {PAPER.author}. Licensed under <a href={PAPER.licenceUrl}>{PAPER.licence}</a>: it may be shared with
          credit, not sold or altered. The code it describes is {BRAND.licence}, at{" "}
          <a href={BRAND.sourceUrl}>{BRAND.sourceUrl.replace(/^https?:\/\//, "")}</a>.
        </footer>
      </article>
    </div>
  );
}
