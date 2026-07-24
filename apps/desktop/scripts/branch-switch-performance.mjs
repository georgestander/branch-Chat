import { app, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererEntry = join(
  desktopRoot,
  ".vite",
  "renderer",
  "main_window",
  "index.html",
);
const preload = join(
  desktopRoot,
  "scripts",
  "branch-switch-performance-preload.cjs",
);
const warmupCount = 10;
const measuredCount = 100;
const p95BudgetMs = 120;
const traceEvent = "branchy:performance:branch-switch-visible";

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
}

async function waitForFixture(window) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 30_000;
      const timeout = setTimeout(() => {
        reject(new Error("Branch-switch fixture did not render in 30 seconds"));
      }, 30_000);
      const check = () => {
        const root = document.querySelector(
          '.branch-card__identity[aria-label$="Root benchmark"]'
        );
        const child = document.querySelector(
          '.branch-card__identity[aria-label$="Child benchmark"]'
        );
        if (root && child) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve();
            })
          );
          return;
        }
        if (performance.now() >= deadline) {
          clearTimeout(timeout);
          reject(new Error("Branch-switch fixture did not render in 30 seconds"));
          return;
        }
        setTimeout(check, 25);
      };
      check();
    })
  `);
}

async function runDomClicks(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const targets = [
        {
          identity: '.branch-card__identity[aria-label$="Child benchmark"]',
          collapse: 'button[aria-label="Collapse Child benchmark"]'
        }
      ];
      const rootTarget = {
        identity: '.branch-card__identity[aria-label$="Root benchmark"]'
      };
      const samples = [];

      const clickAndWait = (target) =>
        new Promise((resolve, reject) => {
          const button = document.querySelector(target.identity);
          if (!(button instanceof HTMLButtonElement)) {
            reject(new Error("Benchmark branch button is missing"));
            return;
          }
          const timeout = setTimeout(() => {
            window.removeEventListener(${JSON.stringify(traceEvent)}, onVisible);
            reject(new Error("Branch switch did not paint within five seconds"));
          }, 5_000);
          const onVisible = (event) => {
            clearTimeout(timeout);
            resolve(event.detail);
          };
          window.addEventListener(
            ${JSON.stringify(traceEvent)},
            onVisible,
            { once: true }
          );
          button.click();
        });

      const collapseAndWait = (target) =>
        new Promise((resolve, reject) => {
          const deadline = performance.now() + 5_000;
          const timeout = setTimeout(() => {
            reject(new Error("Benchmark branch did not collapse"));
          }, 5_000);
          const waitUntilCollapsed = () => {
            if (!document.querySelector(target.collapse)) {
              requestAnimationFrame(() => {
                clearTimeout(timeout);
                resolve();
              });
              return;
            }
            if (performance.now() >= deadline) {
              clearTimeout(timeout);
              reject(new Error("Benchmark branch did not collapse"));
              return;
            }
            requestAnimationFrame(waitUntilCollapsed);
          };
          const button = document.querySelector(target.collapse);
          if (!(button instanceof HTMLButtonElement)) {
            reject(new Error("Expanded benchmark branch did not expose collapse"));
            return;
          }
          button.click();
          requestAnimationFrame(waitUntilCollapsed);
        });

      for (let index = 0; index < ${
        warmupCount + measuredCount
      }; index += 1) {
        const target = targets[0];
        const sample = await clickAndWait(target);
        if (
          sample.totalMessageCount !== 500 ||
          sample.targetMessageCount !== 499 ||
          sample.renderedMessageCount !== 499
        ) {
          throw new Error(
            "Branch switch trace did not represent the 500-message fixture"
          );
        }
        if (index >= ${warmupCount}) samples.push(sample);
        await collapseAndWait(target);
        const resetSample = await clickAndWait(rootTarget);
        if (
          resetSample.totalMessageCount !== 500 ||
          resetSample.targetMessageCount !== 1 ||
          resetSample.renderedMessageCount !== 1
        ) {
          throw new Error("Root reset did not return to the one-message branch");
        }
      }
      return samples;
    })()
  `);
}

function reportError(error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function runBenchmark() {
  let benchmarkWindow;
  try {
    benchmarkWindow = new BrowserWindow({
      show: true,
      width: 1_500,
      height: 950,
      resizable: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await benchmarkWindow.loadFile(rendererEntry, {
      query: { branchyPerformance: "branch-switch" },
    });
    benchmarkWindow.show();
    if (process.platform === "darwin") app.focus({ steal: true });
    benchmarkWindow.focus();
    await withTimeout(
      waitForFixture(benchmarkWindow),
      35_000,
      "Branch-switch fixture readiness exceeded 35 seconds",
    );
    const samples = await withTimeout(
      runDomClicks(benchmarkWindow),
      180_000,
      "Branch-switch benchmark exceeded three minutes",
    );
    const durations = samples.map((sample) => sample.durationMs);
    const representativeSample = samples[0];
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    const maximum = Math.max(...durations);

    process.stdout.write(
      [
        "Branch switch click-to-visible benchmark",
        "fixture: 1-message root and collapsed 499-message child",
        `total messages: ${representativeSample.totalMessageCount}`,
        `target messages: ${representativeSample.targetMessageCount}`,
        `rendered messages: ${representativeSample.renderedMessageCount}`,
        `warmups: ${warmupCount}`,
        `samples: ${samples.length}`,
        `p50: ${p50.toFixed(2)} ms`,
        `p95: ${p95.toFixed(2)} ms`,
        `max: ${maximum.toFixed(2)} ms`,
        `budget: p95 < ${p95BudgetMs} ms`,
      ].join("\n") + "\n",
    );

    if (p95 >= p95BudgetMs) {
      process.stderr.write(
        `Branch switch p95 ${p95.toFixed(2)} ms exceeds the ${p95BudgetMs} ms budget.\n`,
      );
      return 1;
    }
    return 0;
  } catch (error) {
    reportError(error);
    return 1;
  } finally {
    benchmarkWindow?.destroy();
  }
}

const startupTimeout = setTimeout(() => {
  if (!app.isReady()) {
    process.stderr.write(
      "Electron did not become ready for the branch-switch benchmark in 30 seconds.\n",
    );
    app.exit(1);
  }
}, 30_000);

app.whenReady()
  .then(async () => {
    clearTimeout(startupTimeout);
    const exitCode = await runBenchmark();
    app.exit(exitCode);
  })
  .catch((error) => {
    clearTimeout(startupTimeout);
    reportError(error);
    app.exit(1);
  });
