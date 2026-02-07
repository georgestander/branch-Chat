export {};

declare global {
  interface Env extends Cloudflare.Env {
    ConversationGraphDO: DurableObjectNamespace;
    ConversationDirectoryDO: DurableObjectNamespace;
    AccountDO: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    AUTH_REQUIRED?: string;
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
