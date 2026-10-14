import { Badge } from "@pnw/ui/badge";
import { cn } from "@pnw/ui/utils";
import type { LinkStatus } from "./rail";

export const LINK_LABELS: Record<LinkStatus, string> = { typed: "Typed", offered: "Offer sent", linked: "Linked" };

/**
 * Where a party stands with the rail, on every row and form a party appears
 * in: Typed (a name you entered; the books work, nothing else), Offer sent
 * (the agreement is waiting for them), Linked (approved by both sides; can
 * be paid on the rail, receive documents, send hours).
 */
export function LinkBadge({ status, className }: { status: LinkStatus; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-medium",
        status === "typed" && "text-muted-foreground",
        status === "offered" && "border-foreground/30",
        status === "linked" && "border-money-positive/40 text-money-positive",
        className,
      )}
    >
      {LINK_LABELS[status]}
    </Badge>
  );
}
