import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";

interface HeroSectionProps {
  links: LandingLinks;
}

export function HeroSection({ links }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden border-b border-border px-4 pb-10 pt-16 md:px-6 md:pt-24">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-4xl space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Non-linear AI chat for serious thinking
          </p>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Branch ideas at any message.
            <span className="block text-accent">Keep context. Explore alternatives fast.</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            One conversation, many paths. Use branching chat with web search, file upload, and study
            mode, powered by OpenAI API or OpenRouter API.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <LandingTrackedLink
              href={links.signInHref}
              eventName="landing_cta_click"
              eventData={{ cta: "login", location: "hero" }}
              className="inline-flex h-10 items-center rounded border border-border px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary hover:text-foreground"
            >
              Log In
            </LandingTrackedLink>
            <LandingTrackedLink
              href={links.docsHref}
              target="_blank"
              rel="noopener noreferrer"
              eventName="landing_cta_click"
              eventData={{ cta: "open_source", location: "hero" }}
              className="inline-flex h-10 items-center rounded border border-border px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary hover:text-foreground"
            >
              Run Open Source
            </LandingTrackedLink>
            <LandingTrackedLink
              href={links.repoHref}
              target="_blank"
              rel="noopener noreferrer"
              eventName="landing_cta_click"
              eventData={{ cta: "repo", location: "hero" }}
              className="inline-flex h-10 items-center rounded border border-border px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary hover:text-foreground"
            >
              View Source
            </LandingTrackedLink>
          </div>

          <div className="grid max-w-2xl grid-cols-2 gap-2 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground md:grid-cols-4">
            <div className="rounded border border-border bg-background px-3 py-2">Branching Chat</div>
            <div className="rounded border border-border bg-background px-3 py-2">Web Search</div>
            <div className="rounded border border-border bg-background px-3 py-2">File Upload</div>
            <div className="rounded border border-border bg-background px-3 py-2">Study & Learn</div>
          </div>
        </div>
      </div>
    </section>
  );
}
