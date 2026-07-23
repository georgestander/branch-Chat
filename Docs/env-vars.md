# Environment and Release Configuration

## Current Electron App

Branchy Chat Desktop does not require an OpenAI API key, `.dev.vars`, a
Cloudflare binding, or a localhost bridge. Users connect ChatGPT through the
device-code flow in Branchy Chat Desktop. The resulting file-backed credentials
live only in Branchy’s isolated application data directory.

These variables affect desktop packaging, not the installed app at runtime:

| Name | Required | Purpose | Default/Fallback |
| --- | --- | --- | --- |
| `BRANCHY_RELEASE` | No | Enables the fail-closed Developer ID and notarization workflow when exactly `1` | Unset or `0` creates a local QA artifact |
| `BRANCHY_APPLE_SIGNING_IDENTITY` | Required when `BRANCHY_RELEASE=1` | Full `Developer ID Application: Name (TEAMID)` identity installed in the active Keychain | None |
| `BRANCHY_APPLE_NOTARY_PROFILE` | Required when `BRANCHY_RELEASE=1` | `notarytool` Keychain profile used for notarization | None |
| `BRANCHY_ELECTRON_CACHE` | No | Overrides Electron’s download cache directory during packaging | Electron Forge default |

See `apps/desktop/README.md` for local QA and release commands. Do not put
Apple credentials in environment files or the repository; use the macOS
Keychain and a `notarytool` Keychain profile.

## Retained Legacy Web Runtime

The variables and bindings below belong only to the retained
`@branchy/web-legacy` RedwoodSDK/Cloudflare app started with `pnpm dev`. They
are not read by Branchy Chat Desktop.

### Legacy Runtime Variables

| Name | Required | Purpose | Default/Fallback |
| --- | --- | --- | --- |
| `CODEX_BRIDGE_URL` | No | Worker-side URL for the legacy local Codex bridge | `http://127.0.0.1:43991` |
| `AUTH_REQUIRED` | No | Enforces authenticated requests when truthy (`1`, `true`, `yes`, `on`) | Guest fallback auth enabled |
| `AUTH_COOKIE_SECRET` | Required when cookie auth is enforced | HMAC secret used to sign auth cookies and prevent identity tampering | If missing, unsigned cookie identity is rejected unless explicitly allowed for local/insecure fallback |
| `AUTH_TRUST_IDENTITY_HEADERS` | No | Enables Cloudflare Access identity resolution from `cf-access-authenticated-user-email` plus `cf-access-jwt-assertion` verification | Header identity ignored |
| `AUTH_ACCESS_JWKS_URL` | Required when trusted identity headers are enabled in auth-required mode | JWKS endpoint used to verify `cf-access-jwt-assertion` signatures | None |
| `AUTH_ACCESS_AUDIENCE` | Required when trusted identity headers are enabled in auth-required mode | Expected Access audience (`aud`) claim | None |
| `AUTH_ALLOW_LEGACY_COOKIE` | No | Accepts the pre-signing cookie format during migration when a cookie secret is configured | `false` |
| `AUTH_ALLOW_SELF_ASSERTED_SIGN_IN` | No | Re-enables the legacy self-asserted sign-in flow in auth-required mode | `false` |
| `AUTH_ALLOW_INSECURE_UNSIGNED_COOKIE` | No | Allows unsigned cookie identity on non-local hosts when auth is optional | `false` |
| `LANDING_HOSTED_URL` | No | Hosted CTA target for the legacy landing page | `/sign-in?redirectTo=/app` |
| `LANDING_REPO_URL` | No | Source repository CTA | `https://github.com/georgestander/Branch-Chat` |
| `LANDING_DONATE_URL` | No | Primary donation CTA | `https://github.com/sponsors` |
| `LANDING_DONATE_SECONDARY_URL` | No | Secondary donation CTA | `https://www.paypal.com/donate` |
| `LANDING_COMPANY_SPONSOR_URL` | No | Company sponsorship CTA | `mailto:hello@branch-chat.dev` |
| `STUDY_LEARN_WORKFLOW_ID` | No | Reserved workflow identifier | Unset |

### Legacy Cloudflare Bindings

Configured in `wrangler.jsonc`:

| Binding | Type | Purpose |
| --- | --- | --- |
| `ConversationGraphDO` | Durable Object namespace | Per-conversation graph/message persistence |
| `ConversationDirectoryDO` | Durable Object namespace | Conversation directory metadata |
| `AccountDO` | Durable Object namespace | Per-ChatGPT-user composer preference persistence |
| `UploadsBucket` | R2 bucket | Attachment upload and storage backing |
| `ASSETS` | Asset binding | Static asset serving |

### Legacy `.dev.vars`

The optional loopback bridge override is:

```bash
CODEX_BRIDGE_URL="http://127.0.0.1:43991"
```

Do not commit `.dev.vars` or live secrets. This file is not used by the
Electron app.
