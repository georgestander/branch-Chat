import type { ConversationModelId } from "@/lib/conversation";

const AUTH_COOKIE_NAME = "connexus_uid";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const AUTH_COOKIE_VERSION = "v1";

export interface AppAuth {
  userId: string;
  email?: string | null;
}

const AUTH_REQUIRED_TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isGuestUserId(userId: string): boolean {
  return userId.startsWith("guest-");
}

export function isAuthOptionEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return AUTH_REQUIRED_TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isAuthRequiredEnabled(value: string | undefined): boolean {
  return isAuthOptionEnabled(value);
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

export function normalizeAuthUserId(value: string): string | null {
  const normalized = sanitizeUserId(value);
  return normalized.length > 0 ? normalized : null;
}

const signingKeyCache = new Map<string, Promise<CryptoKey>>();

function encodeBytesAsBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeStringAsBase64Url(value: string): string {
  return encodeBytesAsBase64Url(new TextEncoder().encode(value));
}

function decodeBase64UrlToString(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${"=".repeat(paddingLength)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isConstantTimeMatch(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function getCookieSigningKey(secret: string): Promise<CryptoKey> {
  const cached = signingKeyCache.get(secret);
  if (cached) {
    return cached;
  }

  const keyPromise = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  signingKeyCache.set(secret, keyPromise);
  return keyPromise;
}

async function signCookiePayload(secret: string, payload: string): Promise<string> {
  const key = await getCookieSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return encodeBytesAsBase64Url(new Uint8Array(signature));
}

async function createCookieUserValue(options: {
  userId: string;
  authCookieSecret?: string;
}): Promise<string> {
  const secret = options.authCookieSecret?.trim();
  if (!secret) {
    return options.userId;
  }

  // `v1.<base64-user-id>.<hmac>` keeps auth identity tamper-resistant in public beta.
  const encodedUserId = encodeStringAsBase64Url(options.userId);
  const payload = `${AUTH_COOKIE_VERSION}.${encodedUserId}`;
  const signature = await signCookiePayload(secret, payload);
  return `${payload}.${signature}`;
}

async function parseCookieUserValue(options: {
  rawValue: string;
  authCookieSecret?: string;
  allowLegacyUnsigned?: boolean;
}): Promise<string | null> {
  const secret = options.authCookieSecret?.trim();
  if (!secret) {
    const normalized = sanitizeUserId(options.rawValue);
    return normalized || null;
  }

  const segments = options.rawValue.split(".");
  if (segments.length === 3 && segments[0] === AUTH_COOKIE_VERSION) {
    const [version, encodedUserId, signature] = segments;
    const payload = `${version}.${encodedUserId}`;
    const expectedSignature = await signCookiePayload(secret, payload);
    if (!isConstantTimeMatch(expectedSignature, signature)) {
      return null;
    }

    const decodedUserId = decodeBase64UrlToString(encodedUserId);
    if (!decodedUserId) {
      return null;
    }

    const normalized = sanitizeUserId(decodedUserId);
    return normalized || null;
  }

  if (options.allowLegacyUnsigned) {
    const normalized = sanitizeUserId(options.rawValue);
    return normalized || null;
  }

  return null;
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

async function parseAuthFromCookie(options: {
  request: Request;
  authCookieSecret?: string;
  allowLegacyUnsigned?: boolean;
}): Promise<AppAuth | null> {
  const { request, authCookieSecret, allowLegacyUnsigned = false } = options;
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawUserId = cookies.get(AUTH_COOKIE_NAME);
  if (!rawUserId) {
    return null;
  }

  const normalizedUserId = await parseCookieUserValue({
    rawValue: rawUserId,
    authCookieSecret,
    allowLegacyUnsigned,
  });
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
  cookieValue: string;
  maxAgeSeconds?: number;
}): void {
  const {
    request,
    response,
    cookieValue,
    maxAgeSeconds = AUTH_COOKIE_MAX_AGE_SECONDS,
  } = options;
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("; ");

  response.headers.append("Set-Cookie", cookie);
}

export function setAuthCookie(options: {
  request: Request;
  response: { headers: Headers };
  userId: string;
  authCookieSecret?: string;
}): Promise<void> {
  const normalized = normalizeAuthUserId(options.userId);
  if (!normalized) {
    throw new Error("Invalid auth user id.");
  }
  return createCookieUserValue({
    userId: normalized,
    authCookieSecret: options.authCookieSecret,
  }).then((cookieValue) => {
    writeAuthCookie({
      request: options.request,
      response: options.response,
      cookieValue,
    });
  });
}

export function clearAuthCookie(options: {
  request: Request;
  response: { headers: Headers };
}): void {
  writeAuthCookie({
    request: options.request,
    response: options.response,
    cookieValue: "guest-expired",
    maxAgeSeconds: 0,
  });
}

export async function resolveRequestAuth(options: {
  request: Request;
  response: { headers: Headers };
  authRequired?: boolean;
  persistGuestCookie?: boolean;
  authCookieSecret?: string;
  allowIdentityHeaders?: boolean;
  allowLegacyAuthCookie?: boolean;
}): Promise<AppAuth | null> {
  const {
    request,
    response,
    authRequired = false,
    persistGuestCookie = true,
    authCookieSecret,
    allowIdentityHeaders = false,
    allowLegacyAuthCookie = false,
  } = options;
  const hasCookieSecret = Boolean(authCookieSecret?.trim());

  if (allowIdentityHeaders) {
    const headerAuth = parseAuthFromHeaders(request);
    if (headerAuth) {
      return headerAuth;
    }
  }

  if (authRequired && !hasCookieSecret) {
    return null;
  }

  const cookieAuth = await parseAuthFromCookie({
    request,
    authCookieSecret,
    allowLegacyUnsigned: allowLegacyAuthCookie,
  });
  if (cookieAuth && (!authRequired || !isGuestUserId(cookieAuth.userId))) {
    return cookieAuth;
  }

  if (authRequired) {
    return null;
  }

  const fallbackUserId = `guest-${crypto.randomUUID()}`;
  if (persistGuestCookie) {
    await setAuthCookie({
      request,
      response,
      userId: fallbackUserId,
      authCookieSecret,
    });
  }

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
