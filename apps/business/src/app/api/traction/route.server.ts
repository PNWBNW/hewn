// The published traction numbers (counts.ts): countries with enough visitors to
// name, and the totals. Cached for a day at the edge, one copy per asking
// origin; readable cross-site by the app's own origins only.
import { tractionHandler } from "./counts";
import { upstashStore } from "./store";

export async function GET(request: Request): Promise<Response> {
  return tractionHandler(upstashStore())(request);
}
