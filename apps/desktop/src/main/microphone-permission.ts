import type { MicrophonePermissionResult } from "../shared/contracts.ts";

type MacMicrophonePermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface MicrophonePermissionAdapter {
  platform: NodeJS.Platform;
  getStatus(): MacMicrophonePermissionStatus;
  request(): Promise<boolean>;
}

export async function ensureMicrophonePermission(
  adapter: MicrophonePermissionAdapter,
): Promise<MicrophonePermissionResult> {
  if (adapter.platform !== "darwin") {
    return {
      granted: true,
      status: "not-applicable",
    };
  }

  const status = adapter.getStatus();
  if (status === "granted") {
    return { granted: true, status };
  }
  if (status === "denied" || status === "restricted") {
    return { granted: false, status };
  }

  const granted = await adapter.request();
  if (granted) {
    return {
      granted: true,
      status: "granted",
    };
  }

  const deniedStatus = adapter.getStatus();
  if (deniedStatus === "granted") {
    return {
      granted: true,
      status: "granted",
    };
  }
  return {
    granted: false,
    status: deniedStatus === "restricted" ? "restricted" : "denied",
  };
}
