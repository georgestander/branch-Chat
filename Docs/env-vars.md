# Environment Variables and Bindings

Branch Chat uses Cloudflare bindings plus runtime vars in local `.dev.vars` and production Worker settings.

## Deployment Profiles

| Profile | Intended use | Minimum runtime vars | Notes |
| --- | --- | --- | --- |
| Personal production (private) | Cloudflare Access-protected personal app | `OPENAI_API_KEY`, `AUTH_REQUIRED=true`, `AUTH_COOKIE_SECRET`, `AUTH_TRUST_IDENTITY_HEADERS=true`, `BYOK_ENCRYPTION_SECRET` | Trusts identity headers (including `cf-access-authenticated-user-email`) only when explicitly enabled. Persisted BYOK is encrypted server-side. |
| OSS self-host quickstart | Local/dev or lightweight self-host | `OPENAI_API_KEY` | Leave auth off by default. BYOK is still required before send; if `BYOK_ENCRYPTION_SECRET` is missing, users can connect session-only keys that clear on reload. |

## Runtime Variables

| Name | Required | Purpose | Default/Fallback |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | OpenAI key for server-side model utilities and app workflows | None |
| `AUTH_REQUIRED` | No | Enforces authenticated requests when truthy (`1`, `true`, `yes`, `on`) | Guest fallback auth enabled |
| `AUTH_COOKIE_SECRET` | Required when cookie auth is enforced | HMAC secret used to sign auth cookies and prevent identity tampering | Unsigned legacy cookies accepted when `AUTH_REQUIRED` is off |
| `AUTH_TRUST_IDENTITY_HEADERS` | No | Allows trusted identity headers (`x-connexus-user-id`, `x-clerk-user-id`, `cf-access-authenticated-user-email`) | Header identity ignored (deny by default) |
| `AUTH_ALLOW_LEGACY_COOKIE` | No | When truthy and `AUTH_COOKIE_SECRET` is set, accepts pre-signing cookie format during migration | `false` |
| `BYOK_ENCRYPTION_SECRET` | No (recommended for production) | Enables encrypted server persistence for BYOK API keys | If unset: save/delete BYOK in `AccountDO` disabled, but session-only BYOK sends are still allowed |
| `OPENROUTER_API_KEY` | No | Enables server-managed OpenRouter provider support where applicable | OpenRouter features disabled |
| `OPENROUTER_BASE_URL` | No | Base URL for OpenRouter client | `https://openrouter.ai/api/v1` |
| `OPENROUTER_SITE_URL` | No | Referer header for OpenRouter requests | Request origin |
| `OPENROUTER_APP_NAME` | No | Title header for OpenRouter requests | `Branch Chat` |
| `LANDING_HOSTED_URL` | No | Hosted CTA target for `/` landing | `/sign-in?redirectTo=/app` |
| `LANDING_REPO_URL` | No | Source repo URL for landing OSS CTAs | `https://github.com/georgestander/Branch-Chat` |
| `LANDING_DONATE_URL` | No | Primary donation CTA URL on landing | `https://github.com/sponsors` |
| `LANDING_DONATE_SECONDARY_URL` | No | Secondary donation CTA URL on landing | `https://www.paypal.com/donate` |
| `LANDING_COMPANY_SPONSOR_URL` | No | Company sponsorship CTA URL on landing | `mailto:hello@branch-chat.dev` |
| `STUDY_LEARN_WORKFLOW_ID` | No | Reserved workflow identifier for study/learn flows | Unset |

## Cloudflare Bindings

Configured in `wrangler.jsonc`:

| Binding | Type | Purpose |
| --- | --- | --- |
| `ConversationGraphDO` | Durable Object namespace | Per-conversation graph/message persistence |
| `ConversationDirectoryDO` | Durable Object namespace | Conversation directory metadata |
| `AccountDO` | Durable Object namespace | Per-user BYOK metadata + composer preference persistence |
| `UploadsBucket` | R2 bucket | Attachment upload and storage backing |
| `ASSETS` | Asset binding | Static asset serving |

## Local `.dev.vars` Examples

### OSS self-host quickstart

```bash
OPENAI_API_KEY="sk-your-openai-key"
# AUTH_REQUIRED="false"
# BYOK_ENCRYPTION_SECRET=""  # optional; leave unset for session-only BYOK
```

### Personal production-style config

```bash
OPENAI_API_KEY="sk-your-openai-key"
AUTH_REQUIRED="true"
AUTH_COOKIE_SECRET="replace-with-long-random-secret"
AUTH_TRUST_IDENTITY_HEADERS="true"
AUTH_ALLOW_LEGACY_COOKIE="false"
BYOK_ENCRYPTION_SECRET="replace-with-long-random-secret"
# OPENROUTER_API_KEY="or-your-openrouter-key"
# OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
# OPENROUTER_SITE_URL="https://your-host"
# OPENROUTER_APP_NAME="Branch Chat"
```

Do not commit `.dev.vars` or live secrets.
