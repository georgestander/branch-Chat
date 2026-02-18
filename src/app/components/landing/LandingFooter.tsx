import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";

interface LandingFooterProps {
  links: LandingLinks;
}

export function LandingFooter({ links }: LandingFooterProps) {
  return (
    <footer className="mx-auto w-full max-w-6xl border border-t-0 border-border bg-background px-4 py-5 md:px-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Branch-Chat</p>
          <p className="mt-1 text-xs text-muted-foreground">Open source non-linear chat UI for branching workflows.</p>
        </div>

        <nav className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
          <LandingTrackedLink
            href={links.repoHref}
            target="_blank"
            rel="noopener noreferrer"
            eventName="landing_cta_click"
            eventData={{ cta: "repo", location: "footer" }}
            className="rounded border border-border px-3 py-1.5 text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Repo
          </LandingTrackedLink>
          <a
            href={links.docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1.5 text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Docs
          </a>
          <a
            href={links.securityHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1.5 text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Security
          </a>
          <a
            href={links.licenseHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1.5 text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            License
          </a>
          <a
            href={links.changelogHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border px-3 py-1.5 text-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Changelog
          </a>
        </nav>
      </div>
    </footer>
  );
}
