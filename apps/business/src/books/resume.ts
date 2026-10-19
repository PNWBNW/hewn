// ---------------------------------------------------------------------------
// A resume, built from a few questions for someone who doesn't have one
// (docs/JOB_BOARD.md): the answers become plain text the person can edit
// before it goes into an application. Nothing clever: a resume is text,
// and text is what travels. Pure.
// ---------------------------------------------------------------------------

export type ResumeEntry = {
  /** A job title, or a course or qualification. */
  what: string;
  /** The employer or school. */
  place: string;
  /** "2022 to now", "Summer 2024". */
  when: string;
  /** What the person did there, in their own words. */
  notes: string;
};

export type Resume = {
  name: string;
  /** One line: "Line cook, 6 years". */
  headline: string;
  /** How to reach them, as they choose to give it: a phone, an email, a city. */
  contact: string;
  summary: string;
  experience: ResumeEntry[];
  education: ResumeEntry[];
  skills: string;
};

export const emptyResume = (name = ""): Resume => ({ name, headline: "", contact: "", summary: "", experience: [], education: [], skills: "" });
export const emptyEntry = (): ResumeEntry => ({ what: "", place: "", when: "", notes: "" });

const line = (s: string) => s.trim();
const block = (s: string) => s.trim().replace(/\r\n/g, "\n");

function entryText(e: ResumeEntry): string {
  const head = [line(e.what), line(e.place)].filter(Boolean).join(", ");
  const when = line(e.when);
  const lines = [[head, when].filter(Boolean).join(" · ")];
  if (block(e.notes)) lines.push(block(e.notes));
  return lines.join("\n");
}

/** The resume as the text an application carries. Empty sections are left out. */
export function resumeText(r: Resume): string {
  const parts: string[] = [];
  const head = [line(r.name), line(r.headline)].filter(Boolean);
  if (head.length > 0) parts.push(head.join("\n"));
  if (line(r.contact)) parts.push(line(r.contact));
  if (block(r.summary)) parts.push(block(r.summary));
  const experience = r.experience.map(entryText).filter((t) => t.trim());
  if (experience.length > 0) parts.push(`EXPERIENCE\n\n${experience.join("\n\n")}`);
  const education = r.education.map(entryText).filter((t) => t.trim());
  if (education.length > 0) parts.push(`EDUCATION\n\n${education.join("\n\n")}`);
  if (block(r.skills)) parts.push(`SKILLS\n\n${block(r.skills)}`);
  return parts.join("\n\n");
}
