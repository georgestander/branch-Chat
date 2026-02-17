export function ProductScreenshotSection() {
  return (
    <section
      id="product-screenshot"
      className="mx-auto w-full max-w-6xl border-x border-b border-foreground/15 bg-background/80 px-4 py-6 md:px-6 md:py-9"
      aria-labelledby="product-screenshot-heading"
    >
      <div className="mb-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Product in action
        </p>
        <h2
          id="product-screenshot-heading"
          className="text-2xl font-semibold tracking-tight md:text-3xl"
        >
          Real branching workflow, side-by-side
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Parent context stays visible while the active branch explores a new
          direction. This is the actual Branch-Chat workspace captured from the
          running product.
        </p>
      </div>

      <figure className="overflow-hidden rounded-2xl border border-foreground/20 bg-background shadow-sm">
        <img
          src="/landing-branching-screenshot.png"
          alt="Branch-Chat split view showing parent branch context on the left and active branch content on the right."
          className="block h-auto w-full"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>
  );
}
