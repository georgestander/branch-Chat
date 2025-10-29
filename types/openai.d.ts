declare module "openai" {
  export interface OpenAIStream {
    [Symbol.asyncIterator](): AsyncIterator<any>;
    finalResponse(): Promise<any>;
  }

  export interface OpenAIResponsesAPI {
    stream(input: unknown): Promise<OpenAIStream>;
    create(input: unknown): Promise<any>;
  }

  export interface OpenAIClientConfig {
    apiKey?: string;
    organization?: string;
    project?: string;
  }

  export default class OpenAI {
    constructor(config?: OpenAIClientConfig);
    responses: OpenAIResponsesAPI;
  }
}
