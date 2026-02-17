import { LandingShell } from "@/app/components/landing/LandingShell";
import type { LandingLinks } from "@/app/components/landing/types";
import type { AppRequestInfo } from "@/worker";

function normalizeExternalHref(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function resolveRepoDocHref(repoHref: string, suffix: string): string {
  try {
    const parsed = new URL(repoHref);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return repoHref;
    }
    return `${parsed.toString().replace(/\/$/, "")}${suffix}`;
  } catch {
    return repoHref;
  }
}

function resolveLandingLinks(requestInfo: AppRequestInfo): LandingLinks {
  const { env } = requestInfo.ctx;
  const repoUrl = normalizeExternalHref(
    env.LANDING_REPO_URL,
    "https://github.com/georgestander/Branch-Chat",
  );

  return {
    hostedHref: normalizeExternalHref(env.LANDING_HOSTED_URL, "/sign-in?redirectTo=/app"),
    repoHref: repoUrl,
    donatePrimaryHref: normalizeExternalHref(
      env.LANDING_DONATE_URL,
      "https://github.com/sponsors",
    ),
    donateSecondaryHref: normalizeExternalHref(
      env.LANDING_DONATE_SECONDARY_URL,
      "https://www.paypal.com/donate",
    ),
    sponsorCompanyHref: normalizeExternalHref(
      env.LANDING_COMPANY_SPONSOR_URL,
      "mailto:hello@branch-chat.dev",
    ),
    docsHref: resolveRepoDocHref(repoUrl, "/blob/main/Docs/setup.md"),
    securityHref: resolveRepoDocHref(repoUrl, "/blob/main/SECURITY.md"),
    licenseHref: resolveRepoDocHref(repoUrl, "/blob/main/LICENSE"),
    changelogHref: resolveRepoDocHref(repoUrl, "/commits/main"),
  };
}

export async function LandingPage(requestInfo: AppRequestInfo) {
  const requestUrl = new URL(requestInfo.request.url);
  const hasAppDeepLink =
    requestUrl.searchParams.has("conversationId") ||
    requestUrl.searchParams.has("branchId");

  if (hasAppDeepLink) {
    const appUrl = new URL("/app", requestUrl);
    appUrl.search = requestUrl.search;
    requestInfo.ctx.trace("landing:redirect:app-deeplink", {
      fromPath: requestUrl.pathname,
      toPath: appUrl.pathname,
    });
    return Response.redirect(appUrl.toString(), 307);
  }

  requestInfo.ctx.trace("landing:render", {
    path: requestUrl.pathname,
  });

  const links = resolveLandingLinks(requestInfo);

  return <LandingShell links={links} />;
}
