import { describe, expect, it } from "vitest";
import { emptyEntry, emptyResume, resumeText } from "./resume";

describe("a built resume", () => {
  it("reads as plain text, leaving out what's empty", () => {
    const r = {
      ...emptyResume("Kufre A."),
      headline: "Software programmer, 4 years",
      contact: "Lagos · kufre@example.com",
      summary: "Looking for remote work.",
      experience: [{ what: "Programmer", place: "Acme", when: "2022 to now", notes: "Built the billing app." }, emptyEntry()],
      education: [{ what: "BSc Computer Science", place: "UNILAG", when: "2021", notes: "" }],
      skills: "TypeScript, Leo, SQL",
    };
    expect(resumeText(r)).toBe(
      [
        "Kufre A.\nSoftware programmer, 4 years",
        "Lagos · kufre@example.com",
        "Looking for remote work.",
        "EXPERIENCE\n\nProgrammer, Acme · 2022 to now\nBuilt the billing app.",
        "EDUCATION\n\nBSc Computer Science, UNILAG · 2021",
        "SKILLS\n\nTypeScript, Leo, SQL",
      ].join("\n\n"),
    );
    expect(resumeText(emptyResume())).toBe("");
  });
});
