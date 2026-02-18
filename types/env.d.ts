export {};

declare global {
  interface Env extends Cloudflare.Env {
    ConversationGraphDO: DurableObjectNamespace;
    ConversationDirectoryDO: DurableObjectNamespace;
    AccountDO: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    AUTH_REQUIRED?: string;
    AUTH_COOKIE_SECRET?: string;
    AUTH_TRUST_IDENTITY_HEADERS?: string;
    AUTH_ALLOW_LEGACY_COOKIE?: string;
    AUTH_ALLOW_INSECURE_UNSIGNED_COOKIE?: string;
    AUTH_ALLOW_SELF_ASSERTED_SIGN_IN?: string;
    AUTH_ACCESS_JWKS_URL?: string;
    AUTH_ACCESS_AUDIENCE?: string;
    BYOK_ENCRYPTION_SECRET: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_BASE_URL?: string;
    OPENROUTER_SITE_URL?: string;
    OPENROUTER_APP_NAME?: string;
    LANDING_HOSTED_URL?: string;
    LANDING_REPO_URL?: string;
    LANDING_DONATE_URL?: string;
    LANDING_DONATE_SECONDARY_URL?: string;
    LANDING_COMPANY_SPONSOR_URL?: string;
    UploadsBucket: R2Bucket;
    STUDY_LEARN_WORKFLOW_ID?: string;
  }
}
