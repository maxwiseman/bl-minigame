import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Big Liquid",
  description: "Fly SSTA's Big Liquid rocket to 70,000 ft.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
