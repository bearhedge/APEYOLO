/**
 * Three-Model Configuration for Autonomous Agent
 *
 * Three specialized models work together:
 * - THINKER (DeepSeek-R1): Deep analysis, strategy, reasoning
 * - PROCESSOR (Qwen 32B): Validation, critique, processing
 * - EXECUTOR (Qwen 7B): Quick checks, monitoring, execution
 *
 * Code orchestrates which model to use when.
 */

import {
  chatWithLLM,
  streamChatWithLLM,
  THINKER_MODEL,
  PROCESSOR_MODEL,
  EXECUTOR_MODEL,
  type LLMMessage,
  type LLMChatResponse,
  type LLMStreamChunk,
} from './llm-client';

// =============================================================================
// MODEL ROLES
// =============================================================================

export type ModelRole = 'thinker' | 'processor' | 'executor';

export const modelConfig: Record<ModelRole, { model: string; description: string }> = {
  thinker: {
    model: THINKER_MODEL,
    description: 'Deep analysis, strategy reasoning (DeepSeek-R1)',
  },
  processor: {
    model: PROCESSOR_MODEL,
    description: 'Validation, critique, processing (Qwen 32B)',
  },
  executor: {
    model: EXECUTOR_MODEL,
    description: 'Quick checks, monitoring, execution (Qwen 7B)',
  },
};

// =============================================================================
// THINKER - Deep analysis and strategy
// =============================================================================

/**
 * Use the Thinker model for deep analysis
 * - Market analysis
 * - Trade strategy reasoning
 * - Complex decision making
 */
export async function think(
  systemPrompt: string,
  userMessage: string
): Promise<{ content: string; reasoning?: string }> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await chatWithLLM({
    messages,
    model: THINKER_MODEL,
    stream: false,
  });

  return {
    content: response.message.content,
    reasoning: undefined, // Reasoning is inline for DeepSeek-R1
  };
}

/**
 * Stream Thinker response for real-time UI updates
 */
export async function* streamThink(
  systemPrompt: string,
  userMessage: string
): AsyncGenerator<LLMStreamChunk, void, unknown> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  yield* streamChatWithLLM({
    messages,
    model: THINKER_MODEL,
    stream: true,
  });
}

// =============================================================================
// PROCESSOR - Validation and critique
// =============================================================================

/**
 * Use the Processor model for validation
 * - Trade proposal validation
 * - Risk assessment
 * - Compliance checking
 */
export async function process(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await chatWithLLM({
    messages,
    model: PROCESSOR_MODEL,
    stream: false,
  });

  return response.message.content;
}

/**
 * Validate a trade proposal using the Processor
 */
export async function validateProposal(proposal: {
  symbol: string;
  strategy: string;
  reasoning: string;
  strikes?: { put?: number; call?: number };
}): Promise<{
  approved: boolean;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  concerns: string[];
}> {
  const systemPrompt = `You are a risk-focused trade validator. Your job is to critique trade proposals.

Evaluate the proposal for:
1. Risk/reward ratio
2. Market conditions alignment
3. Position sizing appropriateness
4. Timing considerations

Respond in JSON format:
{
  "approved": boolean,
  "reasoning": "string",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "concerns": ["string", ...]
}`;

  const userMessage = `Evaluate this trade proposal:
${JSON.stringify(proposal, null, 2)}`;

  const response = await process(systemPrompt, userMessage);

  // Parse JSON response
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback if parsing fails
  }

  return {
    approved: false,
    reasoning: 'Failed to parse validation response',
    riskLevel: 'HIGH',
    concerns: ['Validation parsing error'],
  };
}

// =============================================================================
// EXECUTOR - Quick operations
// =============================================================================

/**
 * Use the Executor model for quick checks
 * - Market context summarization
 * - Quick status checks
 * - Simple decisions
 */
export async function execute(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await chatWithLLM({
    messages,
    model: EXECUTOR_MODEL,
    stream: false,
  });

  return response.message.content;
}

/**
 * Quick market context check using Executor
 */
export async function quickCheck(context: {
  vix: number;
  spyPrice: number;
  hasPosition: boolean;
  marketHours: boolean;
}): Promise<{
  shouldAnalyze: boolean;
  reason: string;
}> {
  const systemPrompt = `You are a quick market checker. Given market context, decide if deeper analysis is needed.

Rules:
- If VIX > 30: "volatility too high, wait"
- If VIX < 10: "volatility too low for premium"
- If market closed: "market closed"
- If has position: "monitoring existing position"
- If VIX between 12-25 and no position: "conditions favorable, analyze"

Respond in JSON: { "shouldAnalyze": boolean, "reason": "string" }`;

  const userMessage = `Market context:
- VIX: ${context.vix.toFixed(2)}
- SPY: $${context.spyPrice.toFixed(2)}
- Has Position: ${context.hasPosition}
- Market Hours: ${context.marketHours}`;

  const response = await execute(systemPrompt, userMessage);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback
  }

  return {
    shouldAnalyze: false,
    reason: 'Quick check failed',
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get model info for a role
 */
export function getModelForRole(role: ModelRole): string {
  return modelConfig[role].model;
}

/**
 * Get all model configurations
 */
export function getAllModels(): typeof modelConfig {
  return modelConfig;
}
