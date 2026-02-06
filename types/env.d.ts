export {};

declare global {
  interface Env extends Cloudflare.Env {
    ConversationGraphDO: DurableObjectNamespace;
    ConversationDirectoryDO: DurableObjectNamespace;
    AccountDO: DurableObjectNamespace;
    OPENAI_API_KEY: string;
    UploadsBucket: R2Bucket;
    STUDY_LEARN_WORKFLOW_ID?: string;
  }
}
