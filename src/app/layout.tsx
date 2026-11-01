import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";

import ServiceWorker from "@/components/ServiceWorker";
import "./globals.css";

const title = "Big Liquid: The Game";
const description =
  "Load the NOS and GOX, throttle through max Q, dodge birds, jets and space junk, and fly SSTA's Big Liquid rocket to 70,000 ft.";

export const metadata: Metadata = {
  metadataBase: new URL("https://blgame.maxw.app"),
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
  // Home screen launches on iOS go fullscreen, with the game drawn under the status bar
  appleWebApp: { capable: true, title: "Big Liquid", statusBarStyle: "black-translucent" },
};

// No pinch/double-tap zoom getting in the way of the touch controls
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Use the whole screen; the game pads itself clear of the notch and home bar
  viewportFit: "cover",
  themeColor: "#07080d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <ServiceWorker />
      </body>
    </html>
  );
}
