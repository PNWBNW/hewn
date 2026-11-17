// Counting a visit (../traction/counts.ts): country only, totals since launch.
// The app's own pages may ask cross-site (the static bundle on its own address,
// the desktop app); OPTIONS answers their browser's preflight.
import { countHandler, countPreflightHandler } from "../traction/counts";
import { upstashStore } from "../traction/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return countHandler(upstashStore())(request);
}

export function OPTIONS(request: Request): Response {
  return countPreflightHandler()(request);
}
