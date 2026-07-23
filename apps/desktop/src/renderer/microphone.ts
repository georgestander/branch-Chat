export const MICROPHONE_REQUEST_TIMEOUT_MS = 30_000;

export class MicrophoneRequestTimeoutError extends Error {
  constructor() {
    super(
      "The microphone did not respond. Check that an input device is connected, then try again.",
    );
    this.name = "MicrophoneRequestTimeoutError";
  }
}

export function hasAudioInputDevice(
  devices: readonly Pick<MediaDeviceInfo, "kind">[],
): boolean {
  return devices.some((device) => device.kind === "audioinput");
}

export function microphonePermissionRecoveryMessage(
  status: "denied" | "restricted",
): string {
  return status === "restricted"
    ? "Microphone access is restricted by macOS or device management on this Mac."
    : "Microphone access is off. Enable it in System Settings, restart Branchy Chat, then try again.";
}

export async function withMicrophoneRequestTimeout<T>(
  request: Promise<T>,
  options: {
    timeoutMs?: number;
    onLateResult?: (value: T) => void;
  } = {},
): Promise<T> {
  const timeoutMs =
    options.timeoutMs ?? MICROPHONE_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const observedRequest = request.then((value) => {
    if (timedOut) {
      options.onLateResult?.(value);
    }
    return value;
  });
  const timeoutRequest = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new MicrophoneRequestTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([observedRequest, timeoutRequest]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
