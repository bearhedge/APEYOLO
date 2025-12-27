// server/lib/agent/tools/think-deeply.ts
import { chatWithLLM, PROPOSER_MODEL, LLMMessage } from '../../llm-client';

export interface ThinkDeeplyArgs {
  query: string;
  context?: string;
}

export interface ThinkDeeplyResult {
  reasoning: string;
  conclusion: string;
}

/**
 * Think deeply about a question using DeepSeek-R1:70b.
 * This is called when the orchestrator needs complex reasoning.
 */
export async function thinkDeeply(args: ThinkDeeplyArgs): Promise<ThinkDeeplyResult> {
  const systemPrompt = `You are a deep reasoning expert for 0DTE SPY options trading.
Analyze the question thoroughly. Consider risks, market conditions, and trading rules.
Provide your reasoning step by step, then give a clear conclusion.

Format your response as:
REASONING:
[Your step-by-step analysis]

CONCLUSION:
[Your final answer or recommendation]`;

  const userContent = args.context
    ? `Question: ${args.query}\n\nContext:\n${args.context}`
    : args.query;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const response = await chatWithLLM({
    messages,
    model: PROPOSER_MODEL, // DeepSeek-R1:70b
    stream: false,
  });

  const content = response.message.content;

  // Parse reasoning and conclusion
  const reasoningMatch = content.match(/REASONING:\s*([\s\S]*?)(?=CONCLUSION:|$)/i);
  const conclusionMatch = content.match(/CONCLUSION:\s*([\s\S]*?)$/i);

  return {
    reasoning: reasoningMatch?.[1]?.trim() || content,
    conclusion: conclusionMatch?.[1]?.trim() || content,
  };
}
