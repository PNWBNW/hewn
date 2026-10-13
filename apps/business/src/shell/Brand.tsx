/* eslint-disable @next/next/no-img-element -- static brand art, served from /public */
import { cn } from "@pnw/ui/utils";

/** The pine-cone mark on its green tile. */
export function PlumbMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/plumb-mark-dark.png"
      width={size}
      height={size}
      alt=""
      className={cn("shrink-0 rounded-[22%]", className)}
    />
  );
}

/**
 * Mark + wordmark. `onDark` always uses the cream lettering (e.g. the nav
 * rail); `auto` follows the colour scheme (green on light, cream on dark).
 */
export function PlumbLogo({ tone = "auto", height = 28, className }: { tone?: "auto" | "onDark"; height?: number; className?: string }) {
  const wordHeight = Math.round(height * 0.72);
  const wordWidth = Math.round((wordHeight * 373) / 115);
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label="Plumb">
      <PlumbMark size={height} />
      {tone === "onDark" ? (
        <img src="/brand/plumb-wordmark-cream.png" width={wordWidth} height={wordHeight} alt="" />
      ) : (
        <>
          <img src="/brand/plumb-wordmark-green.png" width={wordWidth} height={wordHeight} alt="" className="dark:hidden" />
          <img src="/brand/plumb-wordmark-cream.png" width={wordWidth} height={wordHeight} alt="" className="hidden dark:block" />
        </>
      )}
    </span>
  );
}

/** The front-page hero: the PLUMB tree lettering with its tagline. */
export function PlumbHero({ className }: { className?: string }) {
  return (
    <picture className={cn("block", className)}>
      <source type="image/webp" srcSet="/brand/plumb-hero-768.webp 768w, /brand/plumb-hero-1536.webp 1536w" sizes="100vw" />
      <img
        src="/brand/plumb-hero-1536.jpg"
        width={1536}
        height={729}
        alt="Plumb: honest books, grounded and true."
        className="h-auto w-full object-cover"
        fetchPriority="high"
      />
    </picture>
  );
}
