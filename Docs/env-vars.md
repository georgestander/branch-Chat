# Environment Variables and Bindings

Branch Chat uses Cloudflare bindings plus runtime vars in local `.dev.vars` and production Worker settings.

## Runtime Variables

| Name | Required | Purpose | Default/Fallback |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes (for model responses) | Primary OpenAI API key used by server-side chat flows | None |
| `AUTH_REQUIRED` | No | Enforces authenticated requests when truthy (`1`, `true`, `yes`, `on`) | Guest fallback auth enabled |
| `BYOK_ENCRYPTION_SECRET` | Optional (required for BYOK features) | Secret used to encrypt stored BYOK API keys | BYOK routes report unavailable |
| `OPENROUTER_API_KEY` | No | Enables OpenRouter model provider support | OpenRouter features disabled |
| `OPENROUTER_BASE_URL` | No | Base URL for OpenRouter client | `https://openrouter.ai/api/v1` |
| `OPENROUTER_SITE_URL` | No | Referer header for OpenRouter requests | Request origin |
| `OPENROUTER_APP_NAME` | No | Title header for OpenRouter requests | `Branch Chat` |
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
# BYOK_ENCRYPTION_SECRET="replace-with-long-random-secret"
# OPENROUTER_API_KEY="or-your-openrouter-key"
# OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
# OPENROUTER_SITE_URL="http://localhost:5174"
# OPENROUTER_APP_NAME="Branch Chat (Local)"
```

Do not commit `.dev.vars` or live secrets.
