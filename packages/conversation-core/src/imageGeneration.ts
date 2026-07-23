import type { ToolInvocation } from "./model.ts";

export function hasPendingImageGeneration(
  toolInvocations?: ToolInvocation[] | null,
): boolean {
  return (toolInvocations ?? []).some(
    (invocation) =>
      invocation.toolType === "image_generation" &&
      (invocation.status === "pending" || invocation.status === "running"),
  );
}
