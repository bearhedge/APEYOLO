/**
 * Kimi K2 Client - Decision layer with function calling
 *
 * Moonshot API (Kimi) supports OpenAI-compatible function calling.
 * This client handles tool calls in a loop until a final decision is made.
 */

import { AgentContext, Decision } from '../types';
import { APE_TOOLS, executeTool, ToolCall, FunctionDefinition } from '../tools';
import { logger } from '../logger';

const DECISION_SYSTEM_PROMPT = `You are the decision maker for APE Agent, an autonomous 0DTE SPY options seller.

You've been escalated because the triage layer thinks there's a potential trade opportunity or position that needs attention.

You have access to tools to gather data and execute trades. Use them to:
1. Check current market conditions (get_market_data)
2. Review existing positions (get_positions)
3. Run the trading engine for analysis (run_engine)
4. Execute trades if conditions are right (execute_trade)
5. Close positions when needed (close_position)

WORKFLOW:
1. If you need more data, call the appropriate tool
2. Analyze the results
3. When ready to decide, respond with your final decision JSON

FINAL DECISION FORMAT (respond with this when done analyzing):
{
  "action": "TRADE" | "WAIT" | "CLOSE",
  "reasoning": "your full thinking (3-5 sentences, be specific)",
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

DECISION FRAMEWORK:
- TRADE: High conviction setup, clear direction, acceptable risk
- WAIT: Uncertainty, poor risk/reward, too early, no clear edge
- CLOSE: Position at profit target (50%+) or approaching stop loss

Be decisive. Don't hedge with "maybe" or "could". Make a call.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface KimiResponse {
  choices: Array<{
    message: {
      role: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

export class KimiClient {
  private apiKey: string;
  private baseUrl = 'https://api.moonshot.cn';
  private maxToolCalls = 5; // Prevent infinite loops

  constructor() {
    const key = process.env.KIMI_API_KEY;
    if (!key) {
      console.warn('[Kimi] KIMI_API_KEY not set - client will fail on calls');
    }
    this.apiKey = key || '';
  }

  async decide(
    context: AgentContext,
    escalationReason: string,
    sessionId?: string
  ): Promise<Decision> {
    if (!this.apiKey) {
      return {
        action: 'WAIT',
        reasoning: 'Kimi API key not configured - cannot make trading decisions',
      };
    }

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

    let toolCallCount = 0;

    try {
      while (toolCallCount < this.maxToolCalls) {
        const response = await this.callKimi(messages, APE_TOOLS);

        const message = response.choices[0]?.message;
        if (!message) {
          throw new Error('No message in response');
        }

        // Check if model wants to call tools
        if (message.tool_calls && message.tool_calls.length > 0) {
          toolCallCount++;

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: message.content || '',
            tool_calls: message.tool_calls,
          });

          // Execute each tool call
          for (const toolCall of message.tool_calls) {
            if (sessionId) {
              logger.log({
                sessionId,
                type: 'TOOL',
                message: `Kimi calling: ${toolCall.function.name}`,
              });
            }

            const result = await executeTool(toolCall, sessionId || 'unknown', context);

            // Add tool result to conversation
            messages.push({
              role: 'tool',
              content: JSON.stringify(result.success ? result.result : { error: result.error }),
              tool_call_id: toolCall.id,
            });
          }

          // Continue loop to get next response
          continue;
        }

        // No tool calls - model is returning final decision
        const content = message.content || '';
        return this.parseDecisionResponse(content);
      }

      // Max tool calls reached
      return {
        action: 'WAIT',
        reasoning: `Max tool calls (${this.maxToolCalls}) reached without decision. Defaulting to WAIT.`,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Kimi] Decision error:', errorMessage);
      return {
        action: 'WAIT',
        reasoning: `Error making decision: ${errorMessage}. Defaulting to WAIT for safety.`,
      };
    }
  }

  private async callKimi(
    messages: ChatMessage[],
    tools?: FunctionDefinition[]
  ): Promise<KimiResponse> {
    const body: Record<string, unknown> = {
      model: 'moonshot-v1-8k',
      messages,
      temperature: 0.2,
      max_tokens: 1000,
    };

    // Only include tools if provided
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<KimiResponse>;
  }

  private parseDecisionResponse(content: string): Decision {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const action = parsed.action?.toUpperCase();

      if (!['TRADE', 'WAIT', 'CLOSE'].includes(action)) {
        throw new Error(`Invalid action: ${action}`);
      }

      const decision: Decision = {
        action: action as Decision['action'],
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
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
      console.error('[Kimi] Failed to parse response:', content);
      return {
        action: 'WAIT',
        reasoning: `Failed to parse LLM decision: ${errorMessage}. Defaulting to WAIT.`,
      };
    }
  }
}

// Singleton
export const kimiClient = new KimiClient();
