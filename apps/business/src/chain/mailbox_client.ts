// The one place the app builds a mailbox client, so every screen reaches the
// courier on the right host for this build (src/api_base.ts).
import { MailboxClient } from "@pnw/mailbox";
import { apiUrl } from "../api_base";

export function appMailbox(): MailboxClient {
  return new MailboxClient({ baseUrl: apiUrl("/api/mailbox") });
}
