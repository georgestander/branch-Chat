"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

const DEMO_STEPS = [
  {
    title: "Select a span in the parent branch",
    description: "Pick the exact sentence you want to fork from.",
  },
  {
    title: "Create branch from selection",
    description: "Branch inherits the full context up to that span.",
  },
  {
    title: "Child opens side-by-side",
    description: "Explore an alternative direction without losing your parent thread.",
  },
] as const;

function traceLandingEvent(
  eventName: string,
  eventData?: Record<string, string | number | boolean | null | undefined>,
) {
  if (typeof window === "undefined") {
    return;
  }
  const payload = {
    event: eventName,
    ...eventData,
  };
  console.info(`[TRACE] ${eventName}`, JSON.stringify(payload));
}

export function BranchingDemoIsland() {
  const [currentStep, setCurrentStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!autoPlay || prefersReducedMotion) {
      return;
    }
    if (currentStep >= DEMO_STEPS.length - 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCurrentStep((previous) => Math.min(previous + 1, DEMO_STEPS.length - 1));
    }, 2100);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoPlay, currentStep, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion && autoPlay) {
      setAutoPlay(false);
    }
  }, [autoPlay, prefersReducedMotion]);

  useEffect(() => {
    traceLandingEvent("landing_demo_step", {
      step: currentStep + 1,
    });
  }, [currentStep]);

  const current = DEMO_STEPS[currentStep];
  const selectionActive = currentStep >= 1;
  const childVisible = currentStep >= 2;

  const stepSummary = useMemo(() => {
    return `Step ${currentStep + 1}: ${current.title}`;
  }, [currentStep, current.title]);

  return (
    <section
      id="demo"
      className="mx-auto w-full max-w-6xl scroll-mt-20 border-x border-b border-foreground/15 bg-background/70"
      aria-labelledby="branching-demo-heading"
    >
      <div className="flex flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live product concept
            </p>
            <h2 id="branching-demo-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
              How branching works
            </h2>
            <p className="text-sm text-muted-foreground">{current.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCurrentStep(0);
                if (!prefersReducedMotion) {
                  setAutoPlay(true);
                }
                traceLandingEvent("landing_demo_replay", {});
              }}
              className="rounded-full border border-foreground/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition hover:bg-foreground hover:text-background"
            >
              Replay
            </button>
            <button
              type="button"
              onClick={() => setAutoPlay((value) => !value)}
              disabled={prefersReducedMotion}
              className="rounded-full border border-foreground/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-55"
              aria-pressed={autoPlay}
            >
              Auto-play: {autoPlay ? "On" : "Off"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Branching demo steps">
          {DEMO_STEPS.map((step, index) => {
            const active = index === currentStep;
            return (
              <button
                key={`landing-demo-step-${step.title}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setCurrentStep(index);
                  setAutoPlay(false);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition",
                  active
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-foreground/20 text-muted-foreground hover:text-foreground",
                )}
              >
                Step {index + 1}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-foreground/20 bg-background/80 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Branch Tree
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              <li className="rounded-lg border border-foreground/20 bg-background px-3 py-2">Root branch</li>
              <li
                className={cn(
                  "rounded-lg border px-3 py-2 transition",
                  childVisible
                    ? "border-primary/55 bg-primary/15 text-foreground"
                    : "border-foreground/20 text-muted-foreground",
                )}
              >
                Launch strategy branch
              </li>
            </ul>
          </aside>

          <div className="grid gap-3 md:grid-cols-2">
            <article className="rounded-2xl border border-foreground/20 bg-background/85 p-3">
              <header className="mb-3 flex items-center justify-between border-b border-foreground/15 pb-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Parent Branch
                </span>
                <span className="text-[10px] text-muted-foreground">Context intact</span>
              </header>
              <p className="text-sm leading-relaxed text-foreground">
                We can launch with a
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep(Math.max(currentStep, 1));
                    setAutoPlay(false);
                  }}
                  className={cn(
                    "mx-1 rounded-sm border-b-2 px-1 text-left font-medium transition",
                    selectionActive
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-transparent hover:border-foreground/40",
                  )}
                >
                  focused public beta first
                </button>
                and expand once reliability metrics hold for 72 hours.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCurrentStep(2);
                  setAutoPlay(false);
                }}
                disabled={!selectionActive}
                className="mt-4 inline-flex h-9 items-center rounded-full border border-foreground/20 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] transition hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Branch
              </button>
            </article>

            <article
              className={cn(
                "rounded-2xl border bg-background/85 p-3 transition",
                childVisible
                  ? "border-primary/55"
                  : "border-foreground/20 opacity-70",
              )}
            >
              <header className="mb-3 flex items-center justify-between border-b border-foreground/15 pb-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Child Branch
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {childVisible ? "Active" : "Waiting"}
                </span>
              </header>
              {childVisible ? (
                <div className="space-y-3 text-sm text-foreground">
                  <p>
                    Great. Let&apos;s branch this path and design a launch checklist with risk gates,
                    fallback models, and onboarding milestones.
                  </p>
                  <p className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
                    New branch inherits context up to the selected span.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Child pane appears after selecting the parent span and creating a branch.
                </p>
              )}
            </article>
          </div>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {stepSummary}
      </p>
    </section>
  );
}
