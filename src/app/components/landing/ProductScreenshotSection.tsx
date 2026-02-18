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
          Watch the live branching workflow, then inspect the high-fidelity
          screenshot of the same split-view workspace.
        </p>
      </div>

      <div className="space-y-4">
        <figure className="overflow-hidden rounded-2xl border border-foreground/20 bg-background shadow-sm">
          <video
            className="block h-auto w-full"
            controls
            playsInline
            preload="metadata"
            aria-label="Branch-Chat product demo showing message branching and split-view navigation."
          >
            <source src="/branch-chat-demo.mov" type="video/quicktime" />
            <p className="p-4 text-sm text-muted-foreground">
              Your browser cannot play this video. Open{" "}
              <a href="/branch-chat-demo.mov" className="underline underline-offset-2">
                the demo file directly
              </a>
              .
            </p>
          </video>
        </figure>
        <figure className="overflow-hidden rounded-2xl border border-foreground/20 bg-background shadow-sm">
          <img
            src="/landing-branching-screenshot.png"
            alt="Branch-Chat split view showing parent branch context on the left and active branch content on the right."
            className="block h-auto w-full"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </div>
    </section>
  );
}
