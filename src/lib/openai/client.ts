"use server";

import OpenAI from "openai";

export type OpenAIClient = OpenAI;

export interface OpenAIClientOptions {
  apiKey: string;
  organization?: string;
  project?: string;
}

export function createOpenAIClient(
  options: OpenAIClientOptions,
): OpenAIClient {
  if (!options.apiKey) {
    throw new Error("Missing OpenAI API key");
  }

  return new OpenAI({
    apiKey: options.apiKey,
    organization: options.organization,
    project: options.project,
  });
}
