import { randomUUID } from "node:crypto";

import { DictationRequestError } from "./audio.ts";

export const CHATGPT_TRANSCRIPTION_ENDPOINT =
  "https://chatgpt.com/backend-api/transcribe";

interface ChatGptAuthStatus {
  accessToken: string;
  accountId: string | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function extractChatGptAccountId(
  accessToken: string,
): string | null {
  const encodedPayload = accessToken.split(".")[1];
  if (!encodedPayload) {
    return null;
  }
  try {
    const payload = objectValue(
      JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ),
    );
    if (!payload) {
      return null;
    }
    const auth = objectValue(payload["https://api.openai.com/auth"]);
    return (
      nonEmptyString(auth?.chatgpt_account_id) ??
      nonEmptyString(auth?.account_id) ??
      nonEmptyString(
        payload[
          "https://api.openai.com/auth.chatgpt_account_id"
        ],
      )
    );
  } catch {
    return null;
  }
}

export function parseChatGptAuthStatus(
  value: unknown,
): ChatGptAuthStatus {
  const status = objectValue(value);
  const authMethod = nonEmptyString(status?.authMethod);
  const accessToken = nonEmptyString(status?.authToken);
  if (authMethod !== "chatgpt" || !accessToken) {
    throw new DictationRequestError(
      "ChatGPT dictation needs an active Branchy Chat sign-in",
      401,
    );
  }
  return {
    accessToken,
    accountId: extractChatGptAccountId(accessToken),
  };
}

export function buildChatGptTranscriptionRequest(
  input: Uint8Array,
  auth: ChatGptAuthStatus,
  userAgent: string,
): {
  body: Buffer;
  headers: Record<string, string>;
} {
  const boundary = `----branchy-transcribe-${randomUUID()}`;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n' +
        "Content-Type: audio/wav\r\n\r\n",
      "utf8",
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "User-Agent": userAgent,
  };
  if (auth.accountId) {
    headers["ChatGPT-Account-Id"] = auth.accountId;
  }
  return { body, headers };
}

export async function readChatGptTranscript(
  response: Response,
): Promise<string> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new DictationRequestError(
        "Branchy Chat sign-in expired. Sign in again to use dictation",
        401,
      );
    }
    if (response.status === 429) {
      throw new DictationRequestError(
        "ChatGPT transcription is temporarily rate limited",
        429,
      );
    }
    if (isChatGptSecurityChallenge(response)) {
      throw new DictationRequestError(
        "ChatGPT transcription was blocked by a network security check. Retry, or use another network",
        503,
      );
    }
    throw new DictationRequestError(
      `ChatGPT transcription failed (${response.status})`,
      502,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const transcript = nonEmptyString(objectValue(payload)?.text);
  if (!transcript) {
    throw new DictationRequestError(
      "ChatGPT returned an empty transcript",
      502,
    );
  }
  return transcript;
}

export function isChatGptSecurityChallenge(
  response: Response,
): boolean {
  return (
    response.status === 403 &&
    response.headers.get("cf-mitigated")?.toLowerCase() ===
      "challenge"
  );
}
