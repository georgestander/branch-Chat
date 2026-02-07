"use server";

import { Agent, type AgentInputItem, Runner, withTrace, setDefaultOpenAIClient } from "@openai/agents";

import type { ConversationSettings } from "@/lib/conversation";
import type { OpenAIClient } from "@/lib/openai/client";

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
  openaiClient: OpenAIClient;
}

interface StudyAndLearnAgentResult {
  outputText: string;
  guardrails: {
    normalized: boolean;
    blockedAnswerDump: boolean;
    reasons: string[];
  };
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

const STUDY_MODE_CONTRACT = `STUDY MODE CONTRACT (MANDATORY)
1) Socratic one-step guidance only: advance exactly one small learning step per assistant turn.
2) Never dump full solutions, final answers, or completed homework/test responses.
3) Include a comprehension check each turn so the user can restate or apply the step.
4) Include a short recap each turn that reinforces what was just learned.
5) Ask exactly one learner-facing question per turn and wait for the user's response before continuing.
6) Keep responses concise and action-oriented; no long lectures.

ANTI-ANSWER-DUMP POLICY
- If the user asks for direct answers ("just give me the answer", "solve it for me", "final answer only"), refuse answer-dumping and pivot to one guided step.
- If a response draft accidentally contains a direct final answer for homework-like prompts, replace it with guidance and one question.

OUTPUT RUBRIC (EVERY TURN)
- Line 1: Next step: <single guided step, no final answer>
- Line 2: Comprehension check: <how user shows understanding>
- Line 3: Recap: <one-sentence takeaway>
- Line 4: Your turn: <exactly one question>`;

const HOMEWORK_LIKE_PROMPT_PATTERN =
  /\b(homework|worksheet|quiz|test|exam|assignment|problem set|show work|solve|calculate|derive|proof|equation|integral|derivative|factor|simplify|find x|final answer|multiple choice)\b/i;
const ANSWER_DUMP_PATTERN =
  /\b(final answer|the answer is|therefore the answer|correct answer|solution:\s|result:\s)\b/i;

interface StudyOutputNormalizationResult {
  text: string;
  normalized: boolean;
  blockedAnswerDump: boolean;
  reasons: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function stripLeadingLabel(value: string): string {
  return value.replace(/^[A-Za-z ]{2,40}:\s*/i, "").trim();
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toDeclarativeLine(value: string, fallback: string): string {
  const normalized = toSingleLine(stripLeadingLabel(value))
    .replace(/\?/g, ".")
    .replace(/[.!?]+$/g, "")
    .trim();
  return normalized.length > 0 ? normalized : fallback;
}

function extractFirstQuestion(value: string): string | null {
  const match = value.match(/([^?\n]{4,}\?)/);
  return match ? toSingleLine(match[1]) : null;
}

function ensureQuestion(value: string, fallback: string): string {
  const normalized = toSingleLine(stripLeadingLabel(value))
    .replace(/\?/g, "")
    .replace(/[.!]+$/g, "")
    .trim();
  const candidate = normalized.length > 0 ? normalized : fallback;
  return candidate.endsWith("?") ? candidate : `${candidate}?`;
}

function extractLabeledLine(source: string, labels: string[]): string | null {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const label of labels) {
      const normalizedLabel = `${label.toLowerCase()}:`;
      if (lower.startsWith(normalizedLabel)) {
        return line.slice(normalizedLabel.length).trim();
      }
    }
  }

  return null;
}

function extractFirstStatement(source: string): string {
  const firstLine = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "";
  }
  return firstLine;
}

function countQuestionMarks(value: string): number {
  return (value.match(/\?/g) ?? []).length;
}

function looksLikeAnswerDump(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }
  if (ANSWER_DUMP_PATTERN.test(normalized)) {
    return true;
  }
  const sentences = normalized
    .split(/[.!?]\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return countQuestionMarks(normalized) === 0 && sentences.length >= 4;
}

function isHomeworkLikePrompt(messages: StudyAgentMessage[]): boolean {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUser) {
    return false;
  }
  return HOMEWORK_LIKE_PROMPT_PATTERN.test(latestUser.content);
}

function buildGuardedFallbackQuestion(messages: StudyAgentMessage[]): string {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const rawSnippet = latestUser?.content?.trim() ?? "";
  const snippet = toSingleLine(rawSnippet)
    .replace(/["'?]/g, "")
    .slice(0, 72);
  if (snippet.length > 0) {
    return `What part of "${snippet}" do you already feel confident about?`;
  }
  return "What is the first small part you can identify on your own?";
}

function normalizeStudyOutput(options: {
  rawOutput: string;
  history: StudyAgentMessage[];
}): StudyOutputNormalizationResult {
  const reasons: string[] = [];
  const normalizedSource = normalizeWhitespace(options.rawOutput);
  const fallbackQuestion = buildGuardedFallbackQuestion(options.history);
  const homeworkLike = isHomeworkLikePrompt(options.history);
  const answerDumpDetected = homeworkLike && looksLikeAnswerDump(normalizedSource);

  if (!normalizedSource) {
    reasons.push("empty-output");
  }
  if (answerDumpDetected) {
    reasons.push("answer-dump-blocked");
  }

  if (!normalizedSource || answerDumpDetected) {
    return {
      text: [
        "Next step: Let's work this out one small step at a time instead of jumping to the final answer.",
        "Comprehension check: Name the key concept this question is testing in your own words.",
        "Recap: We focus on process first, then build to the solution together.",
        `Your turn: ${ensureQuestion(fallbackQuestion, fallbackQuestion)}`,
      ].join("\n"),
      normalized: true,
      blockedAnswerDump: answerDumpDetected,
      reasons,
    };
  }

  const nextStep = toDeclarativeLine(
    extractLabeledLine(normalizedSource, ["next step", "step"]) ??
      extractFirstStatement(normalizedSource),
    "Take one small step by identifying what the question is asking and what information is given",
  );
  const comprehensionCheck = toDeclarativeLine(
    extractLabeledLine(normalizedSource, ["comprehension check", "check"]) ??
      "Explain why this step makes sense in your own words",
    "Explain why this step makes sense in your own words",
  );
  const recap = toDeclarativeLine(
    extractLabeledLine(normalizedSource, ["recap", "summary"]) ??
      "One focused step at a time builds understanding",
    "One focused step at a time builds understanding",
  );
  const question = ensureQuestion(
    extractLabeledLine(normalizedSource, ["your turn"]) ??
      extractFirstQuestion(normalizedSource) ??
      fallbackQuestion,
    fallbackQuestion,
  );

  if (
    !extractLabeledLine(normalizedSource, ["next step"]) ||
    !extractLabeledLine(normalizedSource, ["comprehension check"]) ||
    !extractLabeledLine(normalizedSource, ["recap"]) ||
    !extractLabeledLine(normalizedSource, ["your turn"]) ||
    countQuestionMarks(normalizedSource) !== 1
  ) {
    reasons.push("rubric-normalized");
  }

  const normalizedText = [
    `Next step: ${nextStep}`,
    `Comprehension check: ${comprehensionCheck}`,
    `Recap: ${recap}`,
    `Your turn: ${question}`,
  ].join("\n");

  const contentChanged =
    normalizeWhitespace(normalizedText) !== normalizeWhitespace(normalizedSource);
  if (contentChanged && reasons.length === 0) {
    reasons.push("format-rebuilt");
  }

  return {
    text: normalizedText,
    normalized: reasons.length > 0,
    blockedAnswerDump: false,
    reasons,
  };
}

export async function runStudyAndLearnAgent(
  options: StudyAndLearnAgentRunOptions,
): Promise<StudyAndLearnAgentResult> {
  return await withTrace("Study & Learn Agent", async () => {
    setDefaultOpenAIClient(options.openaiClient);
    const combinedInstructions = [
      STUDY_AND_LEARN_BASE_PROMPT.trim(),
      STUDY_MODE_CONTRACT.trim(),
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

    const normalized = normalizeStudyOutput({
      rawOutput: result.finalOutput,
      history: options.history,
    });

    return {
      outputText: normalized.text,
      guardrails: {
        normalized: normalized.normalized,
        blockedAnswerDump: normalized.blockedAnswerDump,
        reasons: normalized.reasons,
      },
    };
  });
}
