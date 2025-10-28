export {};

declare global {
  interface Env extends Cloudflare.Env {
    ConversationGraphDO: DurableObjectNamespace;
    OPENAI_API_KEY: string;
  }
}
