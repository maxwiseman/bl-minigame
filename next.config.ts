import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The Discord adapter pulls in discord.js, whose optional native deps (zlib-sync etc.) can't be bundled
  serverExternalPackages: ["@chat-adapter/discord", "discord.js"],
  async headers() {
    return [
      {
        // Always check for a new service worker, so updates reach installed copies
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
