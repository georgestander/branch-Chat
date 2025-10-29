"use server";

import type { AppContext } from "@/app/context";
import type {
  MessageAttachment,
  ToolInvocation,
  ToolInvocationStatus,
} from "@/lib/conversation";
import {
  FILE_UPLOAD_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/conversation/tools";

export type ResponseToolDefinition =
  | { type: "web_search" }
  | {
      type: "function";
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    };

export interface ToolCallEnvelope {
  id: string;
  type: string;
  name?: string | null;
  arguments?: unknown;
}

export interface ToolExecutionContext {
  ctx: AppContext;
  conversationId: string;
  branchId: string;
  assistantMessageId: string;
}

export interface ToolExecutionResult {
  invocation: ToolInvocation;
  attachments?: MessageAttachment[];
  submission?: {
    tool_call_id: string;
    output: string;
  };
}

export interface ResponseToolsOptions {
  enableFileUploadTool?: boolean;
}

export function getDefaultResponseTools(
  options: ResponseToolsOptions = {},
): ResponseToolDefinition[] {
  const tools: ResponseToolDefinition[] = [{ type: "web_search" }];

  if (options.enableFileUploadTool) {
    tools.push({
      type: "function",
      name: FILE_UPLOAD_TOOL_NAME,
      description:
        "Request that Connexus attaches a user-provided file to the current conversation.",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description:
              "Identifier of the uploaded file within Connexus storage.",
          },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      strict: true,
    });
  }

  return tools;
}

export function createToolInvocationRecord(options: {
  call: ToolCallEnvelope;
  status?: ToolInvocationStatus;
}): ToolInvocation {
  const now = new Date().toISOString();
  const { call, status = "pending" } = options;
  return {
    id: call.id,
    toolType: call.type,
    toolName: call.name ?? undefined,
    callId: call.id,
    input: call.arguments,
    output: undefined,
    status,
    startedAt: now,
    completedAt: undefined,
    error: undefined,
  };
}

export async function executeToolCall(
  context: ToolExecutionContext,
  call: ToolCallEnvelope,
): Promise<ToolExecutionResult> {
  context.ctx.trace("tools:invoke", {
    conversationId: context.conversationId,
    branchId: context.branchId,
    assistantMessageId: context.assistantMessageId,
    toolType: call.type,
    toolName: call.name ?? null,
  });

  const invocation = createToolInvocationRecord({
    call,
    status: "failed",
  });

  invocation.completedAt = new Date().toISOString();
  invocation.error = {
    message: `Tool handler for "${call.type}" is not yet implemented.`,
  };

  return {
    invocation,
  };
}
