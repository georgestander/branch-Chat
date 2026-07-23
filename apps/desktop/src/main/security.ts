import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const APP_HOST = "renderer";
const APP_PROTOCOL = "branchy:";
export const CHATGPT_DEVICE_VERIFICATION_URL =
  "https://auth.openai.com/codex/device";

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export function isAllowedExternalUrl(value: string): boolean {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedChatGptDeviceVerificationUrl(
  value: string,
): boolean {
  return value === CHATGPT_DEVICE_VERIFICATION_URL;
}

export function isTrustedRendererUrl(
  value: string,
  developmentServerUrl?: string,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === APP_PROTOCOL && url.hostname === APP_HOST) {
      return true;
    }
    if (!developmentServerUrl) {
      return false;
    }
    const developmentOrigin = new URL(developmentServerUrl).origin;
    return url.origin === developmentOrigin;
  } catch {
    return false;
  }
}

export function isAllowedAudioMediaPermission(
  permission: string,
  mediaTypes: readonly string[],
  requestingUrl: string,
  developmentServerUrl?: string,
): boolean {
  return (
    permission === "media" &&
    mediaTypes.length === 1 &&
    mediaTypes[0] === "audio" &&
    isTrustedRendererUrl(requestingUrl, developmentServerUrl)
  );
}

export function resolveRendererAsset(
  rendererRoot: string,
  encodedPath: string,
): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  if (
    decodedPath.includes("\0") ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }

  const canonicalRoot = realpathSync(rendererRoot);
  const relativePath = decodedPath.replace(/^\/+/u, "") || "index.html";
  const candidate = resolve(canonicalRoot, relativePath);
  if (!isInside(canonicalRoot, candidate)) {
    return null;
  }

  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      return null;
    }
    const canonicalCandidate = realpathSync(candidate);
    if (!isInside(canonicalRoot, canonicalCandidate)) {
      return null;
    }
    return lstatSync(canonicalCandidate).isFile() ? canonicalCandidate : null;
  } catch {
    return null;
  }
}

export const appProtocol = APP_PROTOCOL.slice(0, -1);
