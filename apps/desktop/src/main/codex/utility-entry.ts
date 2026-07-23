import type { ParentPort } from "electron";

import {
  createBranchyCodexClient,
  type CodexAppServerClient,
} from "./client.ts";
import {
  parseCodexUtilityRequest,
  recoverCodexUtilityRequestId,
  utilityError,
  type CodexUtilityRequest,
  type CodexUtilityWorkerMessage,
} from "./utility-contracts.ts";
import type {
  CodexTurnSession,
  DeviceCodeLoginSession,
} from "./types.ts";

const parentPort = (
  process as NodeJS.Process & { parentPort?: ParentPort | null }
).parentPort;

if (!parentPort) {
  throw new Error("Branchy Codex utility process has no parent port");
}

let client: CodexAppServerClient | null = null;
let initialization: Promise<void> | null = null;
const loginSessions = new Map<string, DeviceCodeLoginSession>();
const turnSessions = new Map<string, CodexTurnSession>();

function post(message: CodexUtilityWorkerMessage): void {
  parentPort.postMessage(message);
}

function diagnostic(message: string): void {
  post({
    kind: "diagnostic",
    message: message.slice(0, 16 * 1024),
  });
}

function requireClient(): CodexAppServerClient {
  if (!client) {
    throw new Error("Branchy Codex utility is not initialized");
  }
  return client;
}

async function initialize(
  request: Extract<CodexUtilityRequest, { method: "initialize" }>,
): Promise<{ ready: true }> {
  if (client || initialization) {
    throw new Error("Branchy Codex utility is already initialized");
  }
  initialization = (async () => {
    const nextClient = await createBranchyCodexClient({
      ...request.input,
      onDiagnostic: (message) => diagnostic(message),
    });
    try {
      await nextClient.start();
      client = nextClient;
    } catch (error) {
      await nextClient.stop().catch(() => undefined);
      throw error;
    }
  })();
  try {
    await initialization;
    return { ready: true };
  } finally {
    initialization = null;
  }
}

async function startDeviceCodeLogin(): Promise<{
  loginId: string;
  verificationUrl: string;
  userCode: string;
}> {
  const session = await requireClient().startDeviceCodeLogin();
  loginSessions.set(session.loginId, session);
  void session.completion
    .then((completion) => {
      post({ kind: "login-completion", completion });
    })
    .catch((error: unknown) => {
      post({
        kind: "login-completion",
        completion: {
          loginId: session.loginId,
          success: false,
          cancelled: false,
          error: utilityError(error).message,
        },
      });
    })
    .finally(() => {
      loginSessions.delete(session.loginId);
    });
  return {
    loginId: session.loginId,
    verificationUrl: session.verificationUrl,
    userCode: session.userCode,
  };
}

async function startTurn(
  request: Extract<CodexUtilityRequest, { method: "startTurn" }>,
): Promise<{ streamId: string; threadId: string }> {
  const session = await requireClient().startTurn(request.input, (event) => {
    post({ kind: "turn-event", event });
  });
  turnSessions.set(session.streamId, session);
  void session.completion.finally(() => {
    turnSessions.delete(session.streamId);
  });
  return {
    streamId: session.streamId,
    threadId: session.threadId,
  };
}

async function stop(): Promise<{ stopped: true }> {
  const activeClient = client;
  client = null;
  if (activeClient) {
    await activeClient.stop();
  }
  loginSessions.clear();
  turnSessions.clear();
  return { stopped: true };
}

async function handleRequest(request: CodexUtilityRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return initialize(request);
    case "readAccount":
      return requireClient().readAccount();
    case "startDeviceCodeLogin":
      return startDeviceCodeLogin();
    case "cancelDeviceCodeLogin":
      return requireClient().cancelDeviceCodeLogin(request.input.loginId);
    case "logoutChatGpt":
      return requireClient().logoutChatGpt();
    case "startTurn":
      return startTurn(request);
    case "cancelTurn":
      return requireClient().cancelTurn(request.input.streamId);
    case "deleteThreads":
      return requireClient().deleteThreads(request.input.threadIds);
    case "transcribeWav":
      return requireClient().transcribeWav(request.input.bytes);
    case "stop":
      return stop();
  }
}

async function dispatch(rawRequest: unknown): Promise<void> {
  let request: CodexUtilityRequest;
  try {
    request = parseCodexUtilityRequest(rawRequest);
  } catch (error) {
    const protocolError = utilityError(error);
    const requestId = recoverCodexUtilityRequestId(rawRequest);
    if (requestId) {
      post({
        kind: "response",
        id: requestId,
        ok: false,
        error: protocolError,
      });
    }
    diagnostic(protocolError.message);
    return;
  }

  try {
    const result = await handleRequest(request);
    post({
      kind: "response",
      id: request.id,
      ok: true,
      result,
    });
  } catch (error) {
    post({
      kind: "response",
      id: request.id,
      ok: false,
      error: utilityError(error),
    });
  }
}

parentPort.on("message", (event) => {
  void dispatch(event.data);
});
