import { AsyncLocalStorage } from "async_hooks";
import { render, route, type RouteMiddleware } from "rwsdk/router";
import { defineApp, type RequestInfo } from "rwsdk/worker";

import { Document } from "@/app/Document";
import type { AppContext } from "@/app/context";
import { setCommonHeaders } from "@/app/headers";
import { Home } from "@/app/pages/Home";
import { resolveRequestAuth } from "@/app/shared/auth.server";
import { getConversationStoreClient } from "@/app/shared/conversationStore.server";
import { handleDirectUploadRequest } from "@/app/shared/uploadsProxy.server";
import { createSSEStream } from "@/app/shared/streaming.server";
import {
  ConversationDirectoryClient,
  getConversationDirectoryStub,
} from "@/lib/durable-objects/ConversationDirectory";
import {
  AccountClient,
  getAccountStub,
} from "@/lib/durable-objects/Account";
import {
  createOpenAIClient,
  type OpenAIClient,
} from "@/lib/openai/client";

export type AppRequestInfo = RequestInfo<any, AppContext>;

const envStorage = new AsyncLocalStorage<Env>();
const openAIClientSymbol = Symbol.for("connexus.openai-client");

const provideAppContext = (): RouteMiddleware<AppRequestInfo> => (requestInfo) => {
  const { ctx, request, response } = requestInfo;
  if ((ctx as Partial<AppContext>).env) {
    return;
  }

  const env = envStorage.getStore();
  if (!env) {
    throw new Error("Environment bindings unavailable in request context");
  }

  const locals = ctx.locals ?? {};
  const auth = resolveRequestAuth({ request, response });
  const requestId =
    request.headers.get("cf-ray") ?? crypto.randomUUID();

  const trace: AppContext["trace"] = (event, data = {}) => {
    const payload = {
      requestId,
      event,
      ...data,
    };
    console.log(
      `[TRACE] ${event}`,
      JSON.stringify(payload),
    );
  };

  const getOpenAIClient = (): OpenAIClient => {
    const cached = locals[openAIClientSymbol] as OpenAIClient | undefined;
    if (cached) {
      return cached;
    }
    const client = createOpenAIClient({
      apiKey: env.OPENAI_API_KEY,
    });
    locals[openAIClientSymbol] = client;
    return client;
  };

  const getConversationStore: AppContext["getConversationStore"] = (
    conversationId,
  ) => getConversationStoreClient(ctx as AppContext, conversationId);

  const directorySymbol = Symbol.for("connexus.conversation-directory-client");
  const getConversationDirectory: AppContext["getConversationDirectory"] = () => {
    const cached = locals[directorySymbol] as ConversationDirectoryClient | undefined;
    if (cached) {
      return cached;
    }
    const stub = getConversationDirectoryStub(env.ConversationDirectoryDO);
    const client = new ConversationDirectoryClient(stub);
    locals[directorySymbol] = client;
    return client;
  };

  const accountSymbol = Symbol.for("connexus.account-client");
  const getAccount: AppContext["getAccount"] = () => {
    const cached = locals[accountSymbol] as AccountClient | undefined;
    if (cached) {
      return cached;
    }
    const stub = getAccountStub(env.AccountDO, auth.userId);
    const client = new AccountClient(stub, auth.userId);
    locals[accountSymbol] = client;
    return client;
  };

  const getUploadsBucket: AppContext["getUploadsBucket"] = () => {
    if (!env.UploadsBucket) {
      throw new Error("Uploads bucket binding is not configured");
    }
    return env.UploadsBucket;
  };

  const context = ctx as AppContext;

  context.env = env;
  context.locals = locals;
  context.requestId = requestId;
  context.auth = auth;
  context.trace = trace;
  context.getOpenAIClient = getOpenAIClient;
  context.getConversationStore = getConversationStore;
  context.getConversationDirectory = getConversationDirectory;
  context.getAccount = getAccount;
  context.getUploadsBucket = getUploadsBucket;
};

const app = defineApp<AppRequestInfo>([
  provideAppContext(),
  setCommonHeaders(),
  route("/_uploads", handleDirectUploadRequest),
  render(Document, [
    route("/", Home),
    route("/events", async ({ request }) => {
      const url = new URL(request.url);
      const streamId = url.searchParams.get("streamId");
      if (!streamId) {
        return new Response("Missing streamId", { status: 400 });
      }
      return createSSEStream(streamId);
    }),
  ]),
]);

export default {
  fetch(request: Request, env: Env, cf: ExecutionContext) {
    return envStorage.run(env, () => app.fetch(request, env, cf));
  },
};

export { ConversationStoreDO } from "@/lib/durable-objects/ConversationStore";
export { ConversationDirectoryDO } from "@/lib/durable-objects/ConversationDirectory";
export { AccountDO } from "@/lib/durable-objects/Account";
