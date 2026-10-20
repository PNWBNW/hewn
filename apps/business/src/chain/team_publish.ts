// ---------------------------------------------------------------------------
// Cutting a team week into posts that each fit one announcement letter
// (letters.ts LETTER_BYTES, sealed): people go into a part in order until the
// next one wouldn't fit, then a new part starts. Every part names the same
// `publishId` and how many parts there are, so a reader shows the week only
// once it has them all (books/team_schedule.ts).
// ---------------------------------------------------------------------------

import { ENVELOPE_OVERHEAD } from "@pnw/mailbox";
import { MAX_TEAM_PARTS, type TeamPart, type TeamPerson, validateTeamPart } from "../books/team_schedule";
import { packPayload } from "./compress";
import { LETTER_BYTES } from "./letters";

/** The post a part travels in, for sizing: the same shape postToChannel seals. */
const sized = async (part: TeamPart, text: string) =>
  (await packPayload(new TextEncoder().encode(JSON.stringify({ version: 1, id: "0".repeat(32), sentAt: new Date(0).toISOString(), text, schedule: part })))).length + ENVELOPE_OVERHEAD;

export const partText = (weekLabel: string, part: number, parts: number) => `Schedule for the week of ${weekLabel}${parts > 1 ? ` (part ${part + 1} of ${parts})` : ""}`;

/** The parts a team week goes out in; throws when one person alone is too much for a letter. */
export async function teamParts(weekStart: string, weekLabel: string, people: readonly TeamPerson[], publishId: string, maxBytes = LETTER_BYTES): Promise<TeamPart[]> {
  const groups: TeamPerson[][] = [];
  let current: TeamPerson[] = [];
  // The text says "part n of m"; size with the longest it could read.
  const text = partText(weekLabel, MAX_TEAM_PARTS - 1, MAX_TEAM_PARTS);
  for (const p of people) {
    const trial = [...current, p];
    if ((await sized({ weekStart, publishId, part: 0, parts: MAX_TEAM_PARTS, people: trial }, text)) <= maxBytes) {
      current = trial;
      continue;
    }
    if (current.length === 0) throw new Error(`${p.name}'s week is too long for one announcement; split their shifts across fewer blocks`);
    groups.push(current);
    current = [p];
    if ((await sized({ weekStart, publishId, part: 0, parts: MAX_TEAM_PARTS, people: current }, text)) > maxBytes) {
      throw new Error(`${p.name}'s week is too long for one announcement; split their shifts across fewer blocks`);
    }
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  if (groups.length > MAX_TEAM_PARTS) throw new Error("The team's week is too big to publish at once");
  return groups.map((g, i) => validateTeamPart({ weekStart, publishId, part: i, parts: groups.length, people: g }));
}
