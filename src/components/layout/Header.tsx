"use client";

import { Show, UserButton } from "@clerk/nextjs";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";

const NAV_LINKS = [
  { href: "/#personas", label: "Personas" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#trust", label: "Platform scope" },
] as const;

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <header className="site-header">
      <div className="wrap nav-row">
        <Logo />

        <nav className="primary-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <Show when="signed-out">
            <Button href="/sign-in" variant="text">
              Sign in
            </Button>
            <Button href="/sign-up" variant="primary">
              Create account
            </Button>
          </Show>
          <Show when="signed-in">
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-9 h-9",
                },
              }}
            />
          </Show>

          <button
            type="button"
            className="mobile-nav-toggle"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={`mobile-nav-panel${mobileOpen ? " open" : ""}`}
      >
        <nav aria-label="Mobile">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={closeMobile}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mobile-nav-actions">
          <Show when="signed-out">
            <Button href="/sign-in" variant="ghost" onClick={closeMobile}>
              Sign in
            </Button>
            <Button href="/sign-up" variant="primary" onClick={closeMobile}>
              Create account
            </Button>
          </Show>
          <Show when="signed-in">
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-9 h-9",
                },
              }}
            />
          </Show>
        </div>
      </div>
    </header>
  );
}
