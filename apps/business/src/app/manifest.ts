import type { MetadataRoute } from "next";

// Lets people add Plumb to their home screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plumb",
    short_name: "Plumb",
    description: "Honest books, grounded and true.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f0e3",
    theme_color: "#113b31",
    icons: [
      { src: "/brand/plumb-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/plumb-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/plumb-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
