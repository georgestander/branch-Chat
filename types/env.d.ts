export {};

declare global {
  interface Env extends Cloudflare.Env {
    ConversationGraphDO: DurableObjectNamespace;
    ConversationDirectoryDO: DurableObjectNamespace;
    OPENAI_API_KEY: string;
  }
}
