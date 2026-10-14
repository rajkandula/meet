import type { MetadataRoute } from "next";

/**
 * The web app manifest that makes Meet installable — Add to Home
 * Screen on Android/iPhone, "Install app" in Chrome/Edge on Windows and Mac.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meet",
    short_name: "Meet",
    description: "A quieter way to meet — video rooms that feel more human.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1326",
    theme_color: "#171f38",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
