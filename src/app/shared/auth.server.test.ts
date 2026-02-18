import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRequestAuth,
  setAuthCookie,
} from "./auth.server.ts";

const ACCESS_JWKS_URL = "https://access.example.com/cdn-cgi/access/certs";
const ACCESS_AUDIENCE = "aud-test-123";

function extractCookiePair(setCookieValue: string): string {
  return setCookieValue.split(";")[0] ?? "";
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJsonBase64Url(value: Record<string, unknown>): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function createAccessJwt(options: {
  email: string;
  audience?: string;
  expiresAtSeconds?: number;
}): Promise<{ token: string; jwk: JsonWebKey & { kid?: string } }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const kid = "test-kid";
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid,
  };
  const payload = {
    aud: options.audience ?? ACCESS_AUDIENCE,
    email: options.email,
    exp: options.expiresAtSeconds ?? now + 300,
    iat: now,
    nbf: now - 1,
  };

  const headerPart = encodeJsonBase64Url(header);
  const payloadPart = encodeJsonBase64Url(payload);
  const signingInput = `${headerPart}.${payloadPart}`;
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const signaturePart = encodeBase64Url(new Uint8Array(signatureBuffer));
  const token = `${signingInput}.${signaturePart}`;

  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwk: JsonWebKey & { kid?: string } = {
    ...publicJwk,
    alg: "RS256",
    use: "sig",
    kid,
  };
  return { token, jwk };
}

async function withMockedAccessJwks(
  jwk: JsonWebKey,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === ACCESS_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=60",
        },
      });
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("signed auth cookie roundtrip resolves user identity", async () => {
  const responseHeaders = new Headers();
  await setAuthCookie({
    request: new Request("https://example.com/sign-in"),
    response: { headers: responseHeaders },
    userId: "person.one",
    authCookieSecret: "test-secret",
  });

  const setCookieValue = responseHeaders.get("set-cookie");
  assert.ok(setCookieValue, "expected auth cookie to be set");

  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        cookie: extractCookiePair(setCookieValue),
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
    authCookieSecret: "test-secret",
  });

  assert.equal(auth?.userId, "person.one");
});

test("tampered signed cookie is rejected when auth is required", async () => {
  const responseHeaders = new Headers();
  await setAuthCookie({
    request: new Request("https://example.com/sign-in"),
    response: { headers: responseHeaders },
    userId: "person.one",
    authCookieSecret: "test-secret",
  });

  const setCookieValue = responseHeaders.get("set-cookie");
  assert.ok(setCookieValue, "expected auth cookie to be set");

  const cookiePair = extractCookiePair(setCookieValue);
  const tamperedCookiePair = cookiePair.replace(/.$/, "x");
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        cookie: tamperedCookiePair,
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
    authCookieSecret: "test-secret",
  });

  assert.equal(auth, null);
});

test("identity headers are ignored by default", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        "x-user-id": "spoof-user",
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
  });

  assert.equal(auth, null);
});

test("cloudflare access email header is ignored unless trusted headers are enabled", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        "cf-access-authenticated-user-email": "person.one@example.com",
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
  });

  assert.equal(auth, null);
});

test("auth-required mode rejects unsigned cookie identity without signing secret", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        cookie: "connexus_uid=spoofed-user",
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
  });

  assert.equal(auth, null);
});

test("cloudflare access email header requires a matching JWT assertion", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        "cf-access-authenticated-user-email": "person.one@example.com",
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
    allowIdentityHeaders: true,
    accessJwksUrl: ACCESS_JWKS_URL,
    accessAudience: ACCESS_AUDIENCE,
  });

  assert.equal(auth, null);
});

test("cloudflare access email header resolves identity with valid JWT assertion", async () => {
  const { token, jwk } = await createAccessJwt({
    email: "person.one@example.com",
  });
  await withMockedAccessJwks(jwk, async () => {
    const auth = await resolveRequestAuth({
      request: new Request("https://example.com/app", {
        headers: {
          "cf-access-authenticated-user-email": "  Person.One@Example.com  ",
          "cf-access-jwt-assertion": token,
        },
      }),
      response: { headers: new Headers() },
      authRequired: true,
      allowIdentityHeaders: true,
      accessJwksUrl: ACCESS_JWKS_URL,
      accessAudience: ACCESS_AUDIENCE,
    });

    assert.equal(auth?.userId, "person.one-example.com");
    assert.equal(auth?.email, "person.one@example.com");
  });
});

test("cloudflare access assertion with wrong audience is rejected", async () => {
  const { token, jwk } = await createAccessJwt({
    email: "person.one@example.com",
    audience: "aud-wrong",
  });
  await withMockedAccessJwks(jwk, async () => {
    const auth = await resolveRequestAuth({
      request: new Request("https://example.com/app", {
        headers: {
          "cf-access-authenticated-user-email": "person.one@example.com",
          "cf-access-jwt-assertion": token,
        },
      }),
      response: { headers: new Headers() },
      authRequired: true,
      allowIdentityHeaders: true,
      accessJwksUrl: ACCESS_JWKS_URL,
      accessAudience: ACCESS_AUDIENCE,
    });
    assert.equal(auth, null);
  });
});

test("cloudflare access assertion with tampered signature is rejected", async () => {
  const { token, jwk } = await createAccessJwt({
    email: "person.one@example.com",
  });
  const tamperedToken = `${token.slice(0, -1)}${
    token.endsWith("A") ? "B" : "A"
  }`;
  await withMockedAccessJwks(jwk, async () => {
    const auth = await resolveRequestAuth({
      request: new Request("https://example.com/app", {
        headers: {
          "cf-access-authenticated-user-email": "person.one@example.com",
          "cf-access-jwt-assertion": tamperedToken,
        },
      }),
      response: { headers: new Headers() },
      authRequired: true,
      allowIdentityHeaders: true,
      accessJwksUrl: ACCESS_JWKS_URL,
      accessAudience: ACCESS_AUDIENCE,
    });
    assert.equal(auth, null);
  });
});

test("auth-required mode denies when trusted headers are enabled but no trusted identity exists", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app"),
    response: { headers: new Headers() },
    authRequired: true,
    allowIdentityHeaders: true,
  });

  assert.equal(auth, null);
});

test("legacy unsigned cookie requires explicit opt-in when signing is enabled", async () => {
  const request = new Request("https://example.com/app", {
    headers: {
      cookie: "connexus_uid=legacy.user",
    },
  });

  const denied = await resolveRequestAuth({
    request,
    response: { headers: new Headers() },
    authRequired: true,
    authCookieSecret: "test-secret",
    allowLegacyAuthCookie: false,
  });
  assert.equal(denied, null);

  const allowed = await resolveRequestAuth({
    request,
    response: { headers: new Headers() },
    authRequired: true,
    authCookieSecret: "test-secret",
    allowLegacyAuthCookie: true,
  });
  assert.equal(allowed?.userId, "legacy.user");
});

test("unsigned cookie identity requires explicit opt-in without signing secret", async () => {
  const request = new Request("https://example.com/app", {
    headers: {
      cookie: "connexus_uid=unsigned.user",
    },
  });

  const denied = await resolveRequestAuth({
    request,
    response: { headers: new Headers() },
    authRequired: false,
    allowUnsignedCookieIdentity: false,
  });
  assert.ok(denied?.userId.startsWith("guest-"));
  assert.notEqual(denied?.userId, "unsigned.user");

  const allowed = await resolveRequestAuth({
    request,
    response: { headers: new Headers() },
    authRequired: false,
    allowUnsignedCookieIdentity: true,
  });
  assert.equal(allowed?.userId, "unsigned.user");
});

test("guest fallback sets signed cookie and can be re-used", async () => {
  const responseHeaders = new Headers();
  const guestAuth = await resolveRequestAuth({
    request: new Request("https://example.com/app"),
    response: { headers: responseHeaders },
    authRequired: false,
    authCookieSecret: "test-secret",
  });

  assert.ok(guestAuth?.userId.startsWith("guest-"));
  const setCookieValue = responseHeaders.get("set-cookie");
  assert.ok(setCookieValue, "expected guest cookie to be set");
  assert.ok(setCookieValue.includes("v1."), "expected signed cookie format");

  const deniedUnderAuthRequired = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        cookie: extractCookiePair(setCookieValue),
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
    authCookieSecret: "test-secret",
  });
  assert.equal(deniedUnderAuthRequired, null);

  const persistedAuth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        cookie: extractCookiePair(setCookieValue),
      },
    }),
    response: { headers: new Headers() },
    authRequired: false,
    authCookieSecret: "test-secret",
  });

  assert.equal(persistedAuth?.userId, guestAuth?.userId);
});
