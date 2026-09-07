import type { ReactNode } from "react";

export const metadata = {
  title: "OurGlass — Batore Personal Assistant",
  description: "Internal conversational assistant (Phase 0 scaffold)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
