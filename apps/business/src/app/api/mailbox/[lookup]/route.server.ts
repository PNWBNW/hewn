// The route is a thin shell: the pinning key comes from the environment at
// request time (so the app keeps working, with a 503 here, when it is unset)
// and everything else is in ../handlers.ts, which is tested with a fake store.
import { mailboxHandlers, type MailboxHandlers } from "../handlers";
import { pinataStore } from "../pinata";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ lookup: string }> };

function handlers(): MailboxHandlers {
  const jwt = process.env.PINATA_JWT;
  return mailboxHandlers(jwt ? pinataStore({ jwt, gateway: process.env.PINATA_GATEWAY }) : null);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handlers().POST(request, (await context.params).lookup);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return handlers().GET(request, (await context.params).lookup);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handlers().DELETE(request, (await context.params).lookup);
}
