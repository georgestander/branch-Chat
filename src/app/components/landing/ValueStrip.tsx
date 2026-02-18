const VALUE_ITEMS = [
  {
    title: "Branch Any Span",
    description: "Create a child branch from any assistant message segment.",
  },
  {
    title: "Side-by-Side Context",
    description: "Parent and child stay visible for clean comparison.",
  },
  {
    title: "BYOK Ready",
    description: "Bring your own key as your usage grows.",
  },
  {
    title: "Open Source",
    description: "Run it yourself, inspect everything, and fork freely.",
  },
] as const;

export function ValueStrip() {
  return (
    <section className="mx-auto w-full max-w-6xl border-x border-b border-foreground/15 bg-background/75 px-4 py-6 md:px-6 md:py-8">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {VALUE_ITEMS.map((item) => (
          <article
            key={item.title}
            className="rounded-xl border border-foreground/20 bg-background/80 px-4 py-3"
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
              {item.title}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
