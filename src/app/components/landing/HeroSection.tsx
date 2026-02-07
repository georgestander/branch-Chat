import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";

interface HeroSectionProps {
  links: LandingLinks;
}

export function HeroSection({ links }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden border-b border-foreground/15 px-4 pb-10 pt-16 md:px-6 md:pt-24">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(110deg,transparent_0%,transparent_42%,color-mix(in_oklab,var(--primary)_15%,transparent)_42%,color-mix(in_oklab,var(--primary)_15%,transparent)_44%,transparent_44%,transparent_100%)]" />
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-4xl space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Non-linear AI chat for serious thinking
          </p>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Branch ideas at any message.
            <span className="block text-primary">Keep context. Explore alternatives fast.</span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Branch-Chat lets you split conversations into parent and child tracks without losing your
            place. Compare paths side-by-side and push deeper where it matters.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <LandingTrackedLink
              href={links.hostedHref}
              eventName="landing_cta_click"
              eventData={{ cta: "hosted", location: "hero" }}
              className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:bg-primary/90"
            >
              Start Free (10 passes)
            </LandingTrackedLink>
            <LandingTrackedLink
              href={links.repoHref}
              target="_blank"
              rel="noopener noreferrer"
              eventName="landing_cta_click"
              eventData={{ cta: "repo", location: "hero" }}
              className="inline-flex h-10 items-center rounded-full border border-foreground/20 px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-foreground hover:text-background"
            >
              Run Open Source
            </LandingTrackedLink>
            <LandingTrackedLink
              href="#donate"
              eventName="landing_cta_click"
              eventData={{ cta: "donate", location: "hero" }}
              className="inline-flex h-10 items-center px-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground underline decoration-foreground/25 underline-offset-4 transition hover:text-foreground"
            >
              Support this project
            </LandingTrackedLink>
          </div>

          <div className="grid max-w-2xl grid-cols-2 gap-2 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground md:grid-cols-4">
            <div className="rounded-lg border border-foreground/15 bg-background/75 px-3 py-2">OSS First</div>
            <div className="rounded-lg border border-foreground/15 bg-background/75 px-3 py-2">BYOK Ready</div>
            <div className="rounded-lg border border-foreground/15 bg-background/75 px-3 py-2">Branch Native</div>
            <div className="rounded-lg border border-foreground/15 bg-background/75 px-3 py-2">No Lock-In</div>
          </div>
        </div>
      </div>
    </section>
  );
}
