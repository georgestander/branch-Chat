const LIVE_FEATURES = [
  {
    title: "Branching Chat",
    description: "Split from any message and explore alternatives side-by-side.",
  },
  {
    title: "Web Search",
    description: "Pull fresh web context into any branch when recency matters.",
  },
  {
    title: "File Upload",
    description: "Ground responses in your docs and files.",
  },
  {
    title: "Study & Learn",
    description: "Socratic guidance that helps you learn, not just copy answers.",
  },
  {
    title: "OpenAI API",
    description: "Use OpenAI models for fast chat and deep reasoning.",
  },
  {
    title: "OpenRouter API",
    description: "Connect to multiple model providers through one compatible API.",
  },
] as const;

const COMING_SOON = [
  {
    title: "Voice & Dictation",
    description: "Talk to your branches hands-free.",
  },
  {
    title: "Sign in with ChatGPT",
    description: "Faster account onboarding.",
  },
  {
    title: "Canvas",
    description: "A visual workspace for drafting, mapping, and iteration.",
  },
] as const;

const STACK_ITEMS = ["RedwoodSDK", "Cloudflare Workers", "Durable Objects", "RSC-first"] as const;

export function ValueStrip() {
  return (
    <section className="mx-auto w-full max-w-6xl border-x border-b border-foreground/15 bg-background/75 px-4 py-6 md:px-6 md:py-9">
      <div className="space-y-7">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Live now</p>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Core capabilities shipping today
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Everything below works today and is available in the current branch experience.
          </p>
        </header>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {LIVE_FEATURES.map((item) => (
            <article
              key={item.title}
              className="rounded-xl border border-foreground/20 bg-background/80 px-4 py-3"
            >
              <p className="inline-flex rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Live
              </p>
              <h3 className="mt-2 text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {item.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
            </article>
          ))}
        </div>

        <article className="rounded-2xl border border-foreground/20 bg-[linear-gradient(120deg,color-mix(in_oklab,var(--primary)_10%,transparent)_0%,transparent_55%)] px-4 py-4 md:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Built for the edge</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">
            RedwoodSDK + Cloudflare foundation
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Built with RedwoodSDK React Server Components and designed to run on Cloudflare Workers
            plus Durable Objects for low-latency, durable branch state.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
            {STACK_ITEMS.map((item) => (
              <span
                key={item}
                className="rounded-full border border-foreground/20 bg-background/80 px-3 py-1 text-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </article>

        <section aria-labelledby="coming-soon-heading" className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Coming soon</p>
            <h3 id="coming-soon-heading" className="text-xl font-semibold tracking-tight md:text-2xl">
              Already in planning and active development
            </h3>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {COMING_SOON.map((item) => (
              <article
                key={item.title}
                className="rounded-xl border border-dashed border-foreground/30 bg-background/60 px-4 py-3"
              >
                <p className="inline-flex rounded-full border border-foreground/30 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Coming soon
                </p>
                <h4 className="mt-2 text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                  {item.title}
                </h4>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
