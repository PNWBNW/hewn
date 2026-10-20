// Cutting a team week into announcement-sized parts (chain/team_publish.ts).

import { describe, expect, it } from "vitest";
import type { TeamPerson } from "../books/team_schedule";
import { teamWeeks } from "../books/team_schedule";
import { partText, teamParts } from "./team_publish";

const SUN = "2026-10-25";
const PUBLISH = "ab".repeat(16);
const person = (n: number): TeamPerson => ({
  who: n.toString(16).padStart(16, "0"),
  name: `Person ${n}`,
  days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${25 + i}`, shifts: [{ start: "07:00", end: "15:30" }], onCall: i % 2 === 0 })),
});

describe("team parts", () => {
  it("sends a small team in one part", async () => {
    const parts = await teamParts(SUN, "Oct 25 – Oct 31", [person(1), person(2)], PUBLISH);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ weekStart: SUN, publishId: PUBLISH, part: 0, parts: 1 });
    expect(partText("Oct 25 – Oct 31", 0, 1)).toBe("Schedule for the week of Oct 25 – Oct 31");
  });

  it("splits a team too big for one letter, keeps everyone in order, and reads back whole", async () => {
    // Weeks like these compress well, so a whole team fits a real letter; a small one forces the split.
    const team = Array.from({ length: 12 }, (_, i) => person(i + 1));
    const parts = await teamParts(SUN, "Oct 25 – Oct 31", team, PUBLISH, 400);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p, i) => p.part === i && p.parts === parts.length)).toBe(true);
    const [week] = teamWeeks(parts.map((p) => ({ sentAt: "2026-10-20T10:00:00.000Z", schedule: p })));
    expect(week!.people.map((p) => p.who)).toEqual(team.map((p) => p.who));
  });

  it("sends an empty publish as one empty part", async () => {
    expect(await teamParts(SUN, "Oct 25 – Oct 31", [], PUBLISH)).toEqual([{ weekStart: SUN, publishId: PUBLISH, part: 0, parts: 1, people: [] }]);
  });

  it("refuses a person whose week alone won't fit", async () => {
    await expect(teamParts(SUN, "Oct 25 – Oct 31", [person(1)], PUBLISH, 100)).rejects.toThrow(/too long/);
  });
});
