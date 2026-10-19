// The published traction numbers (counts.ts): countries with enough visitors to
// name, and the totals. Cached for a day at the edge.
import { tractionHandler } from "./counts";
import { upstashStore } from "./store";

export async function GET(): Promise<Response> {
  return tractionHandler(upstashStore())();
}
