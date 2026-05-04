"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";

const NAV: Array<{ href: string; label: string; activeWhen: (p: string) => boolean }> = [
  { href: "/", label: "Home", activeWhen: (p) => p === "/" },
  { href: "/books", label: "Books", activeWhen: (p) => p === "/books" || p.startsWith("/book/") },
  {
    href: "/periodicals",
    label: "Periodicals",
    activeWhen: (p) => p === "/periodicals",
  },
  {
    href: "/territories",
    label: "Territories",
    activeWhen: (p) => p === "/territories" || p.startsWith("/territory/"),
  },
  {
    href: "/wrestlers",
    label: "Wrestlers",
    activeWhen: (p) => p === "/wrestlers" || p.startsWith("/wrestler/"),
  },
  { href: "/pending", label: "Pending", activeWhen: (p) => p.startsWith("/pending") },
  { href: "/about", label: "About", activeWhen: (p) => p === "/about" },
];

export type MastheadUser = { email: string | null; name: string | null } | null;

export function Masthead({ user }: { user?: MastheadUser }) {
  const pathname = usePathname() ?? "/";
  return (
    <header className="masthead">
      <div className="masthead-rule">
        <div className="brand">
          <span className="brand-mark">PWR</span>
          <span className="brand-sub">Pro Wrestling Data Archive</span>
        </div>
        <nav className="topnav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.activeWhen(pathname) ? "active" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/add"
            className={
              pathname.startsWith("/add") ? "active add-link" : "add-link"
            }
          >
            + Add
          </Link>
          {user ? (
            <form action={logoutAction} className="signout-form">
              <span className="signed-in-as" title={user.email ?? undefined}>
                {user.name ?? user.email ?? "Signed in"}
              </span>
              <button type="submit" className="signout-btn">
                Sign out
              </button>
            </form>
          ) : pathname !== "/login" ? (
            <Link href="/login" className="signin-link">
              Sign in
            </Link>
          ) : null}
        </nav>

        <div className="rule-flourish" aria-hidden="true">
          <svg fill="none" height="15" viewBox="0 0 60 15" width="60" xmlns="http://www.w3.org/2000/svg">
            <path d="M30 7.5L25 2L20 7.5L25 13L30 7.5Z" fill="#1a1a1a" />
            <path d="M30 7.5L35 2L40 7.5L35 13L30 7.5Z" fill="#1a1a1a" />
            <circle cx="14" cy="7.5" fill="#1a1a1a" r="2" />
            <circle cx="46" cy="7.5" fill="#1a1a1a" r="2" />
            <path d="M0 7.5H10M50 7.5H60" stroke="#1a1a1a" strokeWidth="1.5" />
          </svg>
        </div>
        <span className="rule-dot rule-dot-l" />
        <span className="rule-dot rule-dot-r" />
      </div>
    </header>
  );
}
