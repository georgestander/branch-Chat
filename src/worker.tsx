import { AsyncLocalStorage } from "async_hooks";
import { render, route, type RouteMiddleware } from "rwsdk/router";
import { defineApp, type RequestInfo } from "rwsdk/worker";

import { Document } from "@/app/Document";
import type { AppContext } from "@/app/context";
import { setCommonHeaders } from "@/app/headers";
import { Home } from "@/app/pages/Home";
import { LandingPage } from "@/app/pages/landing/LandingPage";
import { SignInPage } from "@/app/pages/sign-in/SignInPage";
import {
  isAuthOptionEnabled,
  isAuthRequiredEnabled,
  resolveRequestAuth,
} from "@/app/shared/auth.server";
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
const openRouterClientSymbol = Symbol.for("connexus.openrouter-client");
const AUTH_OPTIONAL_PATH_PREFIXES = [
  "/",
  "/events",
  "/_uploads",
  "/sign-in",
  "/landing",
] as const;

function isAuthOptionalPath(pathname: string): boolean {
  return AUTH_OPTIONAL_PATH_PREFIXES.some((prefix) => {
    return (
      pathname === prefix ||
      pathname === `${prefix}/` ||
      pathname.startsWith(`${prefix}/`)
    );
  });
}

const provideAppContext = (): RouteMiddleware<AppRequestInfo> => async (requestInfo) => {
  const { ctx, request, response } = requestInfo;
  if ((ctx as Partial<AppContext>).env) {
    return;
  }

  const env = envStorage.getStore();
  if (!env) {
    throw new Error("Environment bindings unavailable in request context");
  }

  const locals = ctx.locals ?? {};
  const requestUrl = new URL(request.url);
  const requestPath = requestUrl.pathname;
  const authRequired =
    isAuthRequiredEnabled(env.AUTH_REQUIRED) && !isAuthOptionalPath(requestPath);
  const requestId =
    request.headers.get("cf-ray") ?? crypto.randomUUID();
  const allowIdentityHeaders = isAuthOptionEnabled(env.AUTH_TRUST_IDENTITY_HEADERS);
  const allowLegacyAuthCookie = isAuthOptionEnabled(env.AUTH_ALLOW_LEGACY_COOKIE);

  if (authRequired && !env.AUTH_COOKIE_SECRET && !allowIdentityHeaders) {
    console.error(
      "[ERROR] auth.config.missing_identity_source",
      JSON.stringify({
        requestId,
        path: requestPath,
        authRequired,
      }),
    );
    return new Response("Server auth configuration missing", { status: 503 });
  }

  const auth = await resolveRequestAuth({
    request,
    response,
    authRequired,
    persistGuestCookie: requestPath !== "/sign-in",
    authCookieSecret: env.AUTH_COOKIE_SECRET,
    allowIdentityHeaders,
    allowLegacyAuthCookie,
  });

  if (!auth) {
    console.log(
      "[TRACE] auth.required.denied",
      JSON.stringify({
        requestId,
        path: requestPath,
        method: request.method,
      }),
    );
    return new Response("Unauthorized", { status: 401 });
  }

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

  const getOpenRouterClient = (): OpenAIClient => {
    const cached = locals[openRouterClientSymbol] as OpenAIClient | undefined;
    if (cached) {
      return cached;
    }
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("Missing OpenRouter API key");
    }
    const referer = env.OPENROUTER_SITE_URL ?? requestUrl.origin;
    const title = env.OPENROUTER_APP_NAME ?? "Branch Chat";
    const client = createOpenAIClient({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": referer,
        "X-Title": title,
      },
    });
    locals[openRouterClientSymbol] = client;
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
  context.getOpenRouterClient = getOpenRouterClient;
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
    route("/", LandingPage),
    route("/app", Home),
    route("/landing", ({ request }) => {
      const url = new URL(request.url);
      const target = new URL("/", url);
      target.search = url.search;
      return Response.redirect(target.toString(), 308);
    }),
    route("/sign-in", SignInPage),
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
