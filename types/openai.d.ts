declare module "openai" {
  export interface OpenAIResponsesAPI {
    stream(input: unknown): Promise<any>;
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
