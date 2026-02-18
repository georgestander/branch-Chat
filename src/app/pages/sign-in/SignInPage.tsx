import type { AppRequestInfo } from "@/worker";

import {
  isAuthOptionEnabled,
  isAuthRequiredEnabled,
  normalizeAuthUserId,
  setAuthCookie,
} from "@/app/shared/auth.server";

function resolveRedirectPath(rawValue: string | null): string {
  if (!rawValue) {
    return "/app";
  }
  if (!rawValue.startsWith("/")) {
    return "/app";
  }
  if (rawValue.startsWith("//")) {
    return "/app";
  }
  return rawValue;
}

function toFormString(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export async function SignInPage({ request, response, ctx }: AppRequestInfo) {
  const requestUrl = new URL(request.url);
  const redirectTo = resolveRedirectPath(requestUrl.searchParams.get("redirectTo"));
  const invalidUserError = requestUrl.searchParams.get("error") === "invalid";
  const allowSelfAssertedSignIn =
    !isAuthRequiredEnabled(ctx.env.AUTH_REQUIRED) ||
    isAuthOptionEnabled(ctx.env.AUTH_ALLOW_SELF_ASSERTED_SIGN_IN);

  if (request.method.toUpperCase() === "POST") {
    if (!allowSelfAssertedSignIn) {
      return new Response(
        "Sign-in is managed by your identity provider for this deployment.",
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const requestedRedirect = resolveRedirectPath(
      toFormString(formData.get("redirectTo")) || redirectTo,
    );
    const requestedUserId = toFormString(formData.get("userId"));
    const normalizedUserId = normalizeAuthUserId(requestedUserId);

    if (!normalizedUserId) {
      const signInUrl = new URL("/sign-in", requestUrl);
      signInUrl.searchParams.set("error", "invalid");
      if (requestedRedirect !== "/app") {
        signInUrl.searchParams.set("redirectTo", requestedRedirect);
      }
      return Response.redirect(signInUrl.toString(), 303);
    }

    await setAuthCookie({
      request,
      response,
      userId: normalizedUserId,
      authCookieSecret: ctx.env.AUTH_COOKIE_SECRET,
    });

    const redirectResponse = new Response(null, {
      status: 303,
      headers: {
        location: new URL(requestedRedirect, requestUrl).toString(),
      },
    });
    for (const [name, value] of response.headers.entries()) {
      redirectResponse.headers.append(String(name), String(value));
    }
    return redirectResponse;
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-5 py-10 text-foreground">
      <main className="panel-surface panel-edge w-full max-w-md rounded-3xl px-6 py-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Branch Chat Beta
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-muted-foreground">
            Use your account identifier to continue into Branch Chat.
          </p>
        </div>

        <form method="post" action="/sign-in" className="mt-6 space-y-3">
          {allowSelfAssertedSignIn ? (
            <>
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <label className="space-y-1">
                <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Account ID or email
                </span>
                <input
                  name="userId"
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              {invalidUserError ? (
                <p className="text-xs text-destructive" role="status">
                  Enter a valid identifier to sign in.
                </p>
              ) : null}
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-full bg-primary px-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:bg-primary/90"
              >
                Continue
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This deployment uses managed identity. Complete sign-in through your
              identity provider, then return to the app.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
