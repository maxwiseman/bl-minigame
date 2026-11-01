import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Big Liquid: The Game",
    short_name: "Big Liquid",
    description:
      "Load the NOS and GOX, throttle through max Q, dodge birds, jets and space junk, and fly SSTA's Big Liquid rocket to 70,000 ft.",
    start_url: "/",
    // iOS treats this as standalone, which still hides Safari's bars
    display: "fullscreen",
    orientation: "portrait",
    background_color: "#07080d",
    theme_color: "#07080d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
