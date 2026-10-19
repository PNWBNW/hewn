// Counting a visit (../traction/counts.ts): country only, totals since launch.
import { countHandler } from "../traction/counts";
import { upstashStore } from "../traction/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return countHandler(upstashStore())(request);
}
