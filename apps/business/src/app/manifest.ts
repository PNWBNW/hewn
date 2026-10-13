import type { MetadataRoute } from "next";
import { BRAND } from "@/brand";

// Lets people add the app to their home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: BRAND.colors.cream,
    theme_color: BRAND.colors.green,
    icons: [
      { src: BRAND.assets.icon192, sizes: "192x192", type: "image/png" },
      { src: BRAND.assets.icon512, sizes: "512x512", type: "image/png" },
      { src: BRAND.assets.iconMaskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
