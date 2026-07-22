"use server";

import type { AppContext } from "../context.ts";
import { transcribeCodexAudio } from "./codexBridge.server.ts";
import {
  readBoundedUploadBytes,
  UploadLimitExceededError,
} from "./uploadBytes.ts";
import type { AppRequestInfo } from "../../worker.tsx";

export const DICTATION_MAX_BODY_BYTES = 6 * 1024 * 1024;

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function handleDictationRequest(
  requestInfo: AppRequestInfo,
): Promise<Response> {
  const { request } = requestInfo;
  const ctx = requestInfo.ctx as AppContext;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "audio/wav") {
    return jsonError("Dictation audio must be a WAV file", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const size = Number(declaredLength);
    if (!Number.isSafeInteger(size) || size <= 0) {
      return jsonError("Invalid dictation content length", 400);
    }
    if (size > DICTATION_MAX_BODY_BYTES) {
      return jsonError("Dictation audio is too large", 413);
    }
  }
  if (!request.body) {
    return jsonError("Missing dictation audio", 400);
  }

  try {
    const bytes = await readBoundedUploadBytes(
      request.body,
      DICTATION_MAX_BODY_BYTES,
    );
    if (bytes.byteLength === 0) {
      return jsonError("Missing dictation audio", 400);
    }
    const startedAt = performance.now();
    const result = await transcribeCodexAudio(bytes, ctx.env);
    ctx.trace("dictation:transcribed", {
      size: bytes.byteLength,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UploadLimitExceededError) {
      return jsonError("Dictation audio is too large", 413);
    }
    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number" &&
      [400, 401, 409, 413, 415, 502, 503, 504].includes(error.status)
        ? error.status
        : 502;
    const message = error instanceof Error
      ? error.message
      : "Dictation transcription failed";
    ctx.trace("dictation:failed", { status });
    return jsonError(message, status);
  }
}
