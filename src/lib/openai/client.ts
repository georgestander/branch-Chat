"use server";

import OpenAI from "openai";

export type OpenAIClient = OpenAI;

export interface OpenAIClientOptions {
  apiKey: string;
  organization?: string;
  project?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export function createOpenAIClient(
  options: OpenAIClientOptions,
): OpenAIClient {
  if (!options.apiKey) {
    throw new Error("Missing OpenAI API key");
  }

  const config: Record<string, unknown> = {
    apiKey: options.apiKey,
    organization: options.organization,
    project: options.project,
  };
  if (options.baseURL) {
    config.baseURL = options.baseURL;
  }
  if (options.defaultHeaders) {
    config.defaultHeaders = options.defaultHeaders;
  }

  return new OpenAI(config as any);
}
