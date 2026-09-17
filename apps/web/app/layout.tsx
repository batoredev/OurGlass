import type { ReactNode } from "react";
import { DM_Sans, Manrope } from "next/font/google";
import "./prototype.css";
import { AppShell } from "./shell";

/**
 * The design's typefaces, self-hosted by `next/font` rather than fetched from
 * Google at render time: no third-party request on the critical path, no
 * layout shift, and nothing for a blocked network to break. The stylesheet
 * reads them through --font / --display.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-text",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: "OurGlass",
  description: "Batore Personal Assistant — an internal conversational assistant",
};

export const viewport = {
  themeColor: "#f6f4ef",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
