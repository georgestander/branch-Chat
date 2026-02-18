"use client";

import { useEffect, useState } from "react";

import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";
import { ThemeToggle } from "@/app/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";

interface TopBarClientProps {
  links: LandingLinks;
}

export function TopBarClient({ links }: TopBarClientProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    console.info("[TRACE] landing_view", JSON.stringify({ event: "landing_view" }));

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 18);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors",
        isScrolled
          ? "border-border bg-background/95 backdrop-blur"
          : "border-transparent bg-background/0",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-foreground"
        >
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
          Branch-Chat
        </a>

        <nav className="flex items-center gap-2" aria-label="Primary">
          <ThemeToggle compact />
          <LandingTrackedLink
            href={links.signInHref}
            eventName="landing_cta_click"
            eventData={{ cta: "login", location: "topbar" }}
            className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Log In
          </LandingTrackedLink>
          <LandingTrackedLink
            href={links.repoHref}
            target="_blank"
            rel="noopener noreferrer"
            eventName="landing_cta_click"
            eventData={{ cta: "repo", location: "topbar" }}
            className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            View Source
          </LandingTrackedLink>
        </nav>
      </div>
    </header>
  );
}
