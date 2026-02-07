import type { ConversationModelId } from "@/lib/conversation";

const AUTH_COOKIE_NAME = "connexus_uid";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface AppAuth {
  userId: string;
  email?: string | null;
}

const AUTH_REQUIRED_TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isGuestUserId(userId: string): boolean {
  return userId.startsWith("guest-");
}

export function isAuthRequiredEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return AUTH_REQUIRED_TRUTHY_VALUES.has(value.trim().toLowerCase());
}

function parseCookies(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  const chunks = cookieHeader.split(";");
  for (const chunk of chunks) {
    const [rawName, ...rawValue] = chunk.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    const value = rawValue.join("=").trim();
    if (!value) {
      continue;
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function sanitizeUserId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 96);
}

function parseAuthFromHeaders(request: Request): AppAuth | null {
  const userIdHeaders = [
    "x-connexus-user-id",
    "x-clerk-user-id",
    "x-user-id",
  ];
  const emailHeaders = [
    "x-connexus-user-email",
    "x-clerk-user-email",
    "x-user-email",
  ];

  let headerUserId: string | null = null;
  for (const headerName of userIdHeaders) {
    const headerValue = request.headers.get(headerName)?.trim();
    if (headerValue) {
      headerUserId = headerValue;
      break;
    }
  }

  if (!headerUserId) {
    return null;
  }

  const normalizedUserId = sanitizeUserId(headerUserId);
  if (!normalizedUserId) {
    return null;
  }

  let email: string | null = null;
  for (const headerName of emailHeaders) {
    const headerValue = request.headers.get(headerName)?.trim();
    if (headerValue) {
      email = headerValue;
      break;
    }
  }

  return {
    userId: normalizedUserId,
    email,
  };
}

function parseAuthFromCookie(request: Request): AppAuth | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawUserId = cookies.get(AUTH_COOKIE_NAME);
  if (!rawUserId) {
    return null;
  }

  const normalizedUserId = sanitizeUserId(rawUserId);
  if (!normalizedUserId) {
    return null;
  }

  return {
    userId: normalizedUserId,
    email: null,
  };
}

function writeAuthCookie(options: {
  request: Request;
  response: { headers: Headers };
  userId: string;
}): void {
  const { request, response, userId } = options;
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    secure ? "Secure" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("; ");

  response.headers.append("Set-Cookie", cookie);
}

export function resolveRequestAuth(options: {
  request: Request;
  response: { headers: Headers };
  authRequired?: boolean;
}): AppAuth | null {
  const { request, response, authRequired = false } = options;

  const headerAuth = parseAuthFromHeaders(request);
  if (headerAuth) {
    return headerAuth;
  }

  const cookieAuth = parseAuthFromCookie(request);
  if (cookieAuth && (!authRequired || !isGuestUserId(cookieAuth.userId))) {
    return cookieAuth;
  }

  if (authRequired) {
    return null;
  }

  const fallbackUserId = `guest-${crypto.randomUUID()}`;
  writeAuthCookie({
    request,
    response,
    userId: fallbackUserId,
  });

  return {
    userId: fallbackUserId,
    email: null,
  };
}

export function getDefaultConversationIdForUser(
  userId: string,
): ConversationModelId {
  const suffix = sanitizeUserId(userId).replace(/[^A-Za-z0-9]+/g, "-");
  const normalizedSuffix = suffix.length > 0 ? suffix : "guest";
  return `default-${normalizedSuffix}` as ConversationModelId;
}
