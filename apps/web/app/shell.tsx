"use client";

/**
 * The prototype's app shell: fixed sidebar on desktop, tab bar on mobile.
 *
 * A client component only because the active item depends on the current
 * route. Everything inside it is rendered on the server.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "./icons";

/** ONE list, so a surface cannot exist in the app and be missing from the nav. */
export const SURFACES = [
  { href: "/", icon: "chat", label: "Chat" },
  { href: "/today", icon: "today", label: "Today" },
  { href: "/commitments", icon: "commitments", label: "Commitments" },
  { href: "/people", icon: "people", label: "People" },
  { href: "/projects", icon: "projects", label: "Projects" },
  { href: "/memory", icon: "memories", label: "Memories" },
  { href: "/files", icon: "files", label: "Files" },
] as const;

const MOBILE = [
  { href: "/", icon: "chat", label: "Chat" },
  { href: "/today", icon: "today", label: "Today" },
  { href: "/commitments", icon: "commitments", label: "Owed" },
  { href: "/memory", icon: "memories", label: "Memory" },
  // "Settings", not "More": the tab goes straight to settings, and a label
  // promising a menu that is not there misleads everyone, sighted or not.
  { href: "/settings", icon: "more", label: "Settings" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  // The sign-in page is its own world: no navigation to surfaces you cannot
  // read yet.
  if (pathname === "/login") return <main className="main">{children}</main>;

  return (
    <div className="app-shell">
      {/* First in tab order, hidden until focused: lets a keyboard user skip
          seven navigation links on every page. Targets <main>, which is
          focusable (tabIndex -1) for exactly this. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        {/* The visible word IS the name (WCAG 2.5.3): a voice-control user says
            what they see. The "O" is the logo mark, decoration only. */}
        <Link className="wordmark" href="/">
          <span className="mark" aria-hidden="true">
            O
          </span>
          <span>OURGLASS</span>
        </Link>
        <nav className="primary-nav">
          {SURFACES.map((surface) => (
            <Link
              key={surface.href}
              className={`nav-item ${isActive(pathname, surface.href) ? "active" : ""}`}
              href={surface.href}
            >
              <Icon name={surface.icon} />
              <span>{surface.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="assistant-state">
            <span className="state-dot" />
            <span>Listening when you need me</span>
          </div>
          <Link
            className={`nav-item ${isActive(pathname, "/settings") ? "active" : ""}`}
            href="/settings"
          >
            <Icon name="settings" />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>

      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {MOBILE.map((tab) => (
          <Link
            key={tab.href}
            className={`mobile-tab ${isActive(pathname, tab.href) ? "active" : ""}`}
            href={tab.href}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
