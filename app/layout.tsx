import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReSource - Solar and Battery Installations",
  description:
    "Interactive Clean Energy Regulator data on Australian rooftop solar and home battery installations - by state, time and metric, with an installation-vintage and waste-arisings projection. Built by ReSource.",
  // favicon uses the black+orange mark so it is legible on a light browser tab
  icons: { icon: "/brand/resource-logo-mark-black.png" },
  openGraph: {
    title: "ReSource - Solar and Battery Installations",
    description:
      "Australian rooftop solar and home battery installations from the Clean Energy Regulator, with a waste-arisings projection.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
