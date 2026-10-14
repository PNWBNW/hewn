/* eslint-disable @next/next/no-img-element -- static brand art, served from /public */
import { cn } from "@pnw/ui/utils";
import { BRAND } from "@pnw/brand";

/** The mark on its tile. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src={BRAND.assets.markDark}
      width={size}
      height={size}
      alt=""
      className={cn("shrink-0 rounded-[22%]", className)}
    />
  );
}

/** Mark + wordmark, following the colour scheme (green on light, cream on dark). */
export function BrandLogo({ height = 28, className }: { height?: number; className?: string }) {
  const wordHeight = Math.round(height * 0.72);
  const wordWidth = Math.round(wordHeight * BRAND.assets.wordmarkAspect);
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label={BRAND.name}>
      <BrandMark size={height} />
      <img src={BRAND.assets.wordmarkOnLight} width={wordWidth} height={wordHeight} alt="" className="dark:hidden" />
      <img src={BRAND.assets.wordmarkOnDark} width={wordWidth} height={wordHeight} alt="" className="hidden dark:block" />
    </span>
  );
}

/**
 * The front-page hero art. The tagline is part of the picture, so the whole
 * image is always shown at its own aspect ratio: never cropped, never a
 * background with a fixed height.
 */
export function BrandHero({ className }: { className?: string }) {
  return (
    <picture className={cn("block", className)}>
      <source type="image/webp" srcSet={`${BRAND.assets.heroWebp768} 768w, ${BRAND.assets.heroWebp1536} 1536w`} sizes="(min-width: 1100px) 1100px, 100vw" />
      <img
        src={BRAND.assets.heroJpg1536}
        width={1536}
        height={729}
        alt={`${BRAND.name}: ${BRAND.tagline}`}
        className="h-auto w-full"
        fetchPriority="high"
      />
    </picture>
  );
}
