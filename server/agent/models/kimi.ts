/**
 * Ollama Decision Client - Decision layer using local deepseek-r1:70b
 *
 * Uses local Ollama for decision making. Since deepseek-r1 doesn't support
 * OpenAI-style function calling, we provide all context upfront and let
 * the model make decisions based on that information.
 */

import { AgentContext, Decision } from '../types';
import { logger } from '../logger';

const DECISION_SYSTEM_PROMPT = `You are the decision maker for APE Agent, an autonomous 0DTE SPY options seller.

You've been escalated because the triage layer thinks there's a potential trade opportunity or position that needs attention.

Analyze the provided market context and make a trading decision. All relevant data is included in the context.

RESPOND WITH JSON ONLY:
{
  "action": "TRADE" | "WAIT" | "CLOSE",
  "reasoning": "your thinking (3-5 sentences, be specific about why)",
  "params": {
    "direction": "PUT" | "CALL",
    "strike": number,
    "contracts": number
  }
}

Only include "params" if action is "TRADE".

GUARDRAILS YOU MUST RESPECT:
- Max 1 trade per day (if tradesToday >= 1, action must be WAIT or CLOSE)
- Stop loss at 3x premium (already calculated, monitor it)
- Max contracts based on account size (see maxContracts in context)
- Only SELL options, never buy
- Strike should be OTM (below SPY for puts, above SPY for calls)

DECISION FRAMEWORK:
- TRADE: High conviction setup, clear direction, acceptable risk
- WAIT: Uncertainty, poor risk/reward, too early, no clear edge
- CLOSE: Position at profit target (50%+) or approaching stop loss

Think step by step, then output your JSON decision.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaResponse {
  choices: Array<{
    message: {
      role: string;
      content?: string;
    };
    finish_reason: string;
  }>;
}

export class KimiClient {
  private baseUrl = 'https://nonperversive-dianne-sketchily.ngrok-free.dev';  // Ollama via ngrok

  constructor() {
    console.log('[Decision] Using local Ollama at', this.baseUrl);
  }

  async decide(
    context: AgentContext,
    escalationReason: string,
    sessionId?: string
  ): Promise<Decision> {
    const messages: ChatMessage[] = [
      { role: 'system', content: DECISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          escalationReason,
          currentContext: context,
        }, null, 2),
      },
    ];

    try {
      if (sessionId) {
        logger.log({
          sessionId,
          type: 'TOOL',
          message: 'Calling local deepseek-r1:70b for decision...',
        });
      }

      const response = await this.callOllama(messages);

      const message = response.choices[0]?.message;
      if (!message) {
        throw new Error('No message in response');
      }

      const content = message.content || '';
      return this.parseDecisionResponse(content, sessionId);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Decision] Error:', errorMessage);
      return {
        action: 'WAIT',
        reasoning: `Error making decision: ${errorMessage}. Defaulting to WAIT for safety.`,
      };
    }
  }

  private async callOllama(messages: ChatMessage[]): Promise<OllamaResponse> {
    const body = {
      model: 'deepseek-r1:70b',
      messages,
      temperature: 0.2,
      max_tokens: 1500,  // Extra tokens for thinking
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<OllamaResponse>;
  }

  private parseDecisionResponse(content: string, sessionId?: string): Decision {
    try {
      // Extract <think>...</think> reasoning from deepseek-r1
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      const thinkingRaw = thinkMatch ? thinkMatch[1].trim() : '';

      // Remove thinking tags to get the answer
      const answerContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // Log thinking to APE activity log if present
      if (thinkingRaw && sessionId) {
        logger.log({
          sessionId,
          type: 'THINK',
          message: `[R1 Reasoning] ${thinkingRaw.substring(0, 500)}${thinkingRaw.length > 500 ? '...' : ''}`,
        });
      }

      // Extract JSON from response
      const jsonMatch = answerContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const action = parsed.action?.toUpperCase();

      if (!['TRADE', 'WAIT', 'CLOSE'].includes(action)) {
        throw new Error(`Invalid action: ${action}`);
      }

      // Include thinking in reasoning if available
      const modelReasoning = String(parsed.reasoning || 'No reasoning provided');

      const decision: Decision = {
        action: action as Decision['action'],
        reasoning: modelReasoning,
      };

      // Validate params if TRADE
      if (action === 'TRADE' && parsed.params) {
        const direction = parsed.params.direction?.toUpperCase();
        if (!['PUT', 'CALL'].includes(direction)) {
          throw new Error(`Invalid direction: ${direction}`);
        }

        decision.params = {
          direction: direction as 'PUT' | 'CALL',
          strike: Number(parsed.params.strike),
          contracts: Math.max(1, Math.floor(Number(parsed.params.contracts) || 1)),
        };

        // Validate strike is reasonable
        if (isNaN(decision.params.strike) || decision.params.strike <= 0) {
          throw new Error('Invalid strike price');
        }
      }

      return decision;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Decision] Failed to parse response:', content);
      return {
        action: 'WAIT',
        reasoning: `Failed to parse LLM decision: ${errorMessage}. Defaulting to WAIT.`,
      };
    }
  }

}

// Singleton
export const kimiClient = new KimiClient();
