// The daily sweep's route: the pinning key and the scheduler's secret come
// from the environment at request time; everything else is in ../sweep.ts.
import { pinataStore } from "../pinata";
import { sweepHandler } from "../sweep";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const jwt = process.env.PINATA_JWT;
  const store = jwt ? pinataStore({ jwt, gateway: process.env.PINATA_GATEWAY }) : null;
  return sweepHandler(store, process.env.CRON_SECRET || null)(request);
}
