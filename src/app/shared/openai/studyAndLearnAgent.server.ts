"use server";

import { Agent, type AgentInputItem, Runner, withTrace } from "@openai/agents";

import type { ConversationSettings } from "@/lib/conversation";

interface StudyAgentMessage {
  role: "user" | "assistant";
  content: string;
}

interface StudyAndLearnAgentRunOptions {
  instructions: string;
  history: StudyAgentMessage[];
  model: string;
  temperature: number;
  reasoningEffort?: ConversationSettings["reasoningEffort"];
  traceMetadata?: Record<string, unknown>;
}

interface StudyAndLearnAgentResult {
  outputText: string;
}

function supportsReasoningEffort(model: string): boolean {
  return model.startsWith("gpt-5-") && !model.includes("chat");
}

const STUDY_AND_LEARN_BASE_PROMPT = `Be an approachable-yet-dynamic teacher, who helps the user learn by guiding them through their studies.
Get to know the user. If you don't know their goals or grade level, ask the user before diving in. (Keep this lightweight!) If they don't answer, aim for explanations that would make sense to a 10th grade student.
Build on existing knowledge. Connect new ideas to what the user already knows.
Guide users, don't just give answers. Use questions, hints, and small steps so the user discovers the answer for themselves.
Check and reinforce. After hard parts, confirm the user can restate or use the idea. Offer quick summaries, mnemonics, or mini-reviews to help the ideas stick.
Vary the rhythm. Mix explanations, questions, and activities (like roleplaying, practice rounds, or asking the user to teach you) so it feels like a conversation, not a lecture.
Above all: DO NOT DO THE USER'S WORK FOR THEM. Don't answer homework questions - help the user find the answer, by working with them collaboratively and building from what they already know.
THINGS YOU CAN DO
Teach new concepts: Explain at the user's level, ask guiding questions, use visuals, then review with questions or a practice round.
Help with homework: Don't simply give answers! Start from what the user knows, help fill in the gaps, give the user a chance to respond, and never ask more than one question at a time.
Practice together: Ask the user to summarize, pepper in little questions, have the user "explain it back" to you, or role-play (e.g., practice conversations in a different language). Correct mistakes - charitably! - in the moment.
Quizzes & test prep: Run practice quizzes. (One question at a time!) Let the user try twice before you reveal answers, then review errors in depth.
TONE & APPROACH
Be warm, patient, and plain-spoken; don't use too many exclamation marks or emoji. Keep the session moving: always know the next step, and switch or end activities once they've done their job. And be brief - don't ever send essay-length responses. Aim for a good back-and-forth.
IMPORTANT
DO NOT GIVE ANSWERS OR DO HOMEWORK FOR THE USER. If the user asks a math or logic problem, or uploads an image of one, DO NOT SOLVE IT in your first response. Instead: talk through the problem with the user, one step at a time, asking a single question at each step, and give the user a chance to RESPOND TO EACH STEP before continuing.`;

export async function runStudyAndLearnAgent(
  options: StudyAndLearnAgentRunOptions,
): Promise<StudyAndLearnAgentResult> {
  return await withTrace("Study & Learn Agent", async () => {
    const combinedInstructions = [
      STUDY_AND_LEARN_BASE_PROMPT.trim(),
      options.instructions.trim(),
    ]
      .filter((value) => value.length > 0)
      .join("\n\n---\n\n");

    const allowReasoning =
      !!options.reasoningEffort && supportsReasoningEffort(options.model);

    const agent = new Agent({
      name: "Study and Learn",
      instructions: combinedInstructions,
      model: options.model,
      modelSettings: {
        temperature: options.temperature,
        topP: 1,
        maxTokens: 2048,
        store: true,
        ...(allowReasoning
          ? { reasoning: { effort: options.reasoningEffort } }
          : {}),
      },
    });

    const conversationHistory: AgentInputItem[] = options.history.map((message) => {
      if (message.role === "assistant") {
        return {
          role: "assistant" as const,
          status: "completed" as const,
          content: [
            {
              type: "output_text" as const,
              text: message.content,
            },
          ],
        };
      }

      return {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: message.content,
          },
        ],
      };
    });

    if (conversationHistory.length === 0) {
      throw new Error("Study & Learn agent requires at least one user message");
    }

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "connexus",
        ...(options.traceMetadata ?? {}),
      },
    });

    const result = await runner.run(agent, conversationHistory);

    if (!result.finalOutput) {
      throw new Error("Study & Learn agent result is undefined");
    }

    return {
      outputText: result.finalOutput,
    };
  });
}
