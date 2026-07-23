export const BRANCH_SWITCH_VISIBLE_EVENT =
  "branchy:performance:branch-switch-visible";

export type BranchSwitchVisibleSample = {
  durationMs: number;
  totalMessageCount: number;
  targetMessageCount: number;
  renderedMessageCount: number;
};

type BranchSwitchTarget = {
  branchId: string;
  totalMessageCount: number;
  targetMessageCount: number;
};

type RenderedBranch = {
  branchId: string;
  renderedMessageCount: number;
};

type BranchSwitchPaintRecorderOptions = {
  now: () => number;
  requestFrame: (callback: () => void) => void;
  onSample: (sample: BranchSwitchVisibleSample) => void;
};

export class BranchSwitchPaintRecorder {
  private pending: (BranchSwitchTarget & { startedAt: number }) | null = null;
  private awaitingPaint = false;
  private generation = 0;
  private readonly options: BranchSwitchPaintRecorderOptions;

  constructor(options: BranchSwitchPaintRecorderOptions) {
    this.options = options;
  }

  start(target: BranchSwitchTarget): void {
    this.generation += 1;
    this.pending = {
      ...target,
      startedAt: this.options.now(),
    };
    this.awaitingPaint = false;
  }

  completeAfterPaint(rendered: RenderedBranch): void {
    if (
      !this.pending ||
      this.awaitingPaint ||
      rendered.branchId !== this.pending.branchId ||
      rendered.renderedMessageCount !== this.pending.targetMessageCount
    ) {
      return;
    }

    const generation = this.generation;
    this.awaitingPaint = true;
    this.options.requestFrame(() => {
      this.options.requestFrame(() => {
        if (generation !== this.generation || !this.pending) return;
        const sample: BranchSwitchVisibleSample = {
          durationMs: this.options.now() - this.pending.startedAt,
          totalMessageCount: this.pending.totalMessageCount,
          targetMessageCount: this.pending.targetMessageCount,
          renderedMessageCount: rendered.renderedMessageCount,
        };
        this.pending = null;
        this.awaitingPaint = false;
        this.options.onSample(sample);
      });
    });
  }
}

export function percentile(
  samples: readonly number[],
  quantile: number,
): number {
  if (samples.length === 0) {
    throw new Error("At least one performance sample is required");
  }
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new Error("Quantile must be between zero and one");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index]!;
}

function performanceTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("branchyPerformance") ===
    "branch-switch"
  );
}

const browserRecorder = performanceTraceEnabled()
  ? new BranchSwitchPaintRecorder({
      now: () => window.performance.now(),
      requestFrame: (callback) => {
        window.requestAnimationFrame(() => callback());
      },
      onSample: (sample) => {
        window.dispatchEvent(
          new CustomEvent<BranchSwitchVisibleSample>(
            BRANCH_SWITCH_VISIBLE_EVENT,
            { detail: sample },
          ),
        );
      },
    })
  : null;

export function startBranchSwitchPaintTrace(
  target: () => BranchSwitchTarget,
): void {
  if (browserRecorder) browserRecorder.start(target());
}

export function completeBranchSwitchPaintTrace(rendered: RenderedBranch): void {
  browserRecorder?.completeAfterPaint(rendered);
}
