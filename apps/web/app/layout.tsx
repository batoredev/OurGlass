import type { ReactNode } from "react";
import { DM_Sans, Fraunces } from "next/font/google";
import "./prototype.css";
// The landscape editorial theme (2026-11-05). It only re-styles: drop this
// line and the previous look returns.
import "./theme.css";
import { AppShell } from "./shell";

/**
 * The design's typefaces, self-hosted by `next/font` rather than fetched from
 * Google at render time: no third-party request on the critical path, no
 * layout shift, and nothing for a blocked network to break. The stylesheet
 * reads them through --font / --display: DM Sans for text, Fraunces (a
 * variable serif, its optical size following the type size) for display.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-text",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: "OurGlass",
  description: "Batore Personal Assistant — an internal conversational assistant",
};

export const viewport = {
  themeColor: "#f6ecda",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${fraunces.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
