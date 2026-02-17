import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRequestAuth,
  setAuthCookie,
} from "./auth.server.ts";

function extractCookiePair(setCookieValue: string): string {
  return setCookieValue.split(";")[0] ?? "";
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

test("identity headers can be enabled explicitly", async () => {
  const auth = await resolveRequestAuth({
    request: new Request("https://example.com/app", {
      headers: {
        "x-clerk-user-id": "trusted.user",
        "x-clerk-user-email": "trusted@example.com",
      },
    }),
    response: { headers: new Headers() },
    authRequired: true,
    allowIdentityHeaders: true,
  });

  assert.equal(auth?.userId, "trusted.user");
  assert.equal(auth?.email, "trusted@example.com");
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
