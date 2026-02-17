# Environment Variables and Bindings

Branch Chat uses Cloudflare bindings plus runtime vars in local `.dev.vars` and production Worker settings.

## Runtime Variables

| Name | Required | Purpose | Default/Fallback |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes (for model responses) | Primary OpenAI API key used by server-side chat flows | None |
| `AUTH_REQUIRED` | No | Enforces authenticated requests when truthy (`1`, `true`, `yes`, `on`) | Guest fallback auth enabled; protected routes return `503` if no trusted identity source is configured |
| `AUTH_COOKIE_SECRET` | Required for cookie-based auth in public beta | HMAC secret used to sign auth cookies and prevent identity tampering | Unsigned legacy cookies accepted when `AUTH_REQUIRED` is off |
| `AUTH_TRUST_IDENTITY_HEADERS` | No | Allows identity headers (`x-connexus-user-id`, `x-clerk-user-id`) when truthy | Header identity ignored (deny by default) |
| `AUTH_ALLOW_LEGACY_COOKIE` | No | When truthy and `AUTH_COOKIE_SECRET` is set, accepts pre-signing cookie format during migration | `false` |
| `BYOK_ENCRYPTION_SECRET` | Optional (required for BYOK features) | Secret used to encrypt stored BYOK API keys | BYOK routes report unavailable |
| `OPENROUTER_API_KEY` | No | Enables OpenRouter model provider support | OpenRouter features disabled |
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
| `AccountDO` | Durable Object namespace | Per-user quota + BYOK metadata |
| `UploadsBucket` | R2 bucket | Attachment upload and storage backing |
| `ASSETS` | Asset binding | Static asset serving |

## Local `.dev.vars` Example

```bash
OPENAI_API_KEY="sk-your-openai-key"
# AUTH_REQUIRED="true"
# AUTH_COOKIE_SECRET="replace-with-long-random-secret"
# AUTH_TRUST_IDENTITY_HEADERS="false"
# AUTH_ALLOW_LEGACY_COOKIE="false"
# BYOK_ENCRYPTION_SECRET="replace-with-long-random-secret"
# OPENROUTER_API_KEY="or-your-openrouter-key"
# OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
# OPENROUTER_SITE_URL="http://localhost:5174"
# OPENROUTER_APP_NAME="Branch Chat (Local)"
# LANDING_HOSTED_URL="/sign-in?redirectTo=/app"
# LANDING_REPO_URL="https://github.com/georgestander/Branch-Chat"
# LANDING_DONATE_URL="https://github.com/sponsors/your-account"
# LANDING_DONATE_SECONDARY_URL="https://www.paypal.com/donate?hosted_button_id=..."
# LANDING_COMPANY_SPONSOR_URL="mailto:hello@branch-chat.dev"
```

Do not commit `.dev.vars` or live secrets.
