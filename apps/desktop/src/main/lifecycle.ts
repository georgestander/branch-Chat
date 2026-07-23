export interface QuitEvent {
  preventDefault(): void;
}

export interface QuitCoordinatorOptions {
  shutdown(): Promise<void>;
  hideWindows(): void;
  quit(): void;
  exit(exitCode: number): void;
  onError(error: unknown): void;
  timeoutMilliseconds?: number;
  scheduleTimeout?(
    callback: () => void,
    timeoutMilliseconds: number,
  ): ReturnType<typeof setTimeout>;
  cancelTimeout?(timeout: ReturnType<typeof setTimeout>): void;
}

export interface QuitCoordinator {
  handleBeforeQuit(event: QuitEvent): void;
  isShuttingDown(): boolean;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MILLISECONDS = 5_000;

export function shouldReportRendererLoadFailure(
  isShuttingDown: boolean,
  isWindowDestroyed: boolean,
): boolean {
  return !isShuttingDown && !isWindowDestroyed;
}

export function createQuitCoordinator({
  shutdown,
  hideWindows,
  quit,
  exit,
  onError,
  timeoutMilliseconds = DEFAULT_SHUTDOWN_TIMEOUT_MILLISECONDS,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}: QuitCoordinatorOptions): QuitCoordinator {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0
  ) {
    throw new TypeError("timeoutMilliseconds must be a positive integer");
  }

  let shutdownStarted = false;
  let shutdownComplete = false;
  let terminationStarted = false;

  const reportError = (error: unknown): void => {
    try {
      onError(error);
    } catch {
      // Diagnostics must never stop the app from terminating.
    }
  };

  const handleBeforeQuit = (event: QuitEvent): void => {
    if (shutdownComplete) {
      return;
    }
    event.preventDefault();
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;

    try {
      hideWindows();
    } catch (error) {
      reportError(error);
    }

    const timeout = scheduleTimeout(() => {
      if (terminationStarted) {
        return;
      }
      terminationStarted = true;
      shutdownComplete = true;
      exit(0);
    }, timeoutMilliseconds);

    void Promise.resolve()
      .then(shutdown)
      .catch((error: unknown) => {
        reportError(error);
      })
      .finally(() => {
        if (terminationStarted) {
          return;
        }
        terminationStarted = true;
        cancelTimeout(timeout);
        shutdownComplete = true;
        quit();
      });
  };

  return {
    handleBeforeQuit,
    isShuttingDown: () => shutdownStarted,
  };
}
