import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";

interface DonateSectionProps {
  links: LandingLinks;
}

export function DonateSection({ links }: DonateSectionProps) {
  return (
    <section
      id="donate"
      className="mx-auto w-full max-w-6xl scroll-mt-20 border-x border-b border-foreground/15 bg-background/80 px-4 py-6 md:px-6 md:py-9"
      aria-labelledby="donate-heading"
    >
      <div className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Support the work
        </p>
        <h2 id="donate-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
          Help fund reliability and open-source maintenance
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Hosted beta stays free while we improve branching UX, reliability, and docs. Donations
          keep infra online and accelerate feature delivery.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <LandingTrackedLink
          href={links.donatePrimaryHref}
          target="_blank"
          rel="noopener noreferrer"
          eventName="landing_donate_click"
          eventData={{ provider: "primary" }}
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:bg-primary/90"
        >
          Donate (Primary)
        </LandingTrackedLink>
        <LandingTrackedLink
          href={links.donateSecondaryHref}
          target="_blank"
          rel="noopener noreferrer"
          eventName="landing_donate_click"
          eventData={{ provider: "secondary" }}
          className="inline-flex h-10 items-center rounded-full border border-foreground/20 px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-foreground hover:text-background"
        >
          Donate (Backup)
        </LandingTrackedLink>
        <LandingTrackedLink
          href={links.sponsorCompanyHref}
          target="_blank"
          rel="noopener noreferrer"
          eventName="landing_donate_click"
          eventData={{ provider: "company" }}
          className="inline-flex h-10 items-center rounded-full border border-foreground/20 px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-foreground hover:text-background"
        >
          Sponsor via Company
        </LandingTrackedLink>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Hosted demo remains free during beta; donations directly fund uptime, model spend, and OSS
        improvements.
      </p>
    </section>
  );
}
