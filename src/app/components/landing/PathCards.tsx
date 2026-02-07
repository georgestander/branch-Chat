import { LandingTrackedLink } from "@/app/components/landing/LandingTrackedLink";
import type { LandingLinks } from "@/app/components/landing/types";

interface PathCardsProps {
  links: LandingLinks;
}

export function PathCards({ links }: PathCardsProps) {
  return (
    <section className="mx-auto w-full max-w-6xl border-x border-b border-foreground/15 bg-background/75 px-4 py-6 md:px-6 md:py-9">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Choose your path
        </p>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Hosted or Open Source</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-foreground/20 bg-background/85 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Fastest Start
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">Launch Hosted</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Sign in and start with 10 free demo passes. Perfect for testing branching workflows in
            minutes.
          </p>
          <LandingTrackedLink
            href={links.hostedHref}
            eventName="landing_path_select"
            eventData={{ path: "hosted" }}
            className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:bg-primary/90"
          >
            Launch Hosted
          </LandingTrackedLink>
        </article>

        <article className="rounded-2xl border border-foreground/20 bg-background/85 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Own the stack
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">Run Open Source</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Clone the repo, configure env vars, and run your own Branch-Chat deployment.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-foreground/20 bg-foreground px-3 py-2 text-[11px] leading-relaxed text-background">
{`git clone <repo-url>
cd Branch-Chat
pnpm install && npm run dev`}
          </pre>
          <LandingTrackedLink
            href={links.repoHref}
            target="_blank"
            rel="noopener noreferrer"
            eventName="landing_path_select"
            eventData={{ path: "oss" }}
            className="mt-4 inline-flex h-10 items-center rounded-full border border-foreground/20 px-5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-foreground hover:text-background"
          >
            Open GitHub Repo
          </LandingTrackedLink>
        </article>
      </div>
    </section>
  );
}
