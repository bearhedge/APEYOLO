import { AgentContext, Decision } from '../types';

const DECISION_SYSTEM_PROMPT = `You are the decision maker for APE Agent, an autonomous 0DTE SPY options seller.

You've been escalated because the triage layer thinks there's a potential trade opportunity or position that needs attention.

Your job:
1. Analyze the context deeply
2. Decide whether to trade, wait, or close existing position
3. If trading, specify exact parameters

Respond with JSON only:
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

export class KimiClient {
  private apiKey: string;
  private baseUrl = 'https://api.moonshot.cn';

  constructor() {
    const key = process.env.KIMI_API_KEY;
    if (!key) {
      console.warn('[Kimi] KIMI_API_KEY not set - client will fail on calls');
    }
    this.apiKey = key || '';
  }

  async decide(context: AgentContext, escalationReason: string): Promise<Decision> {
    if (!this.apiKey) {
      return {
        action: 'WAIT',
        reasoning: 'Kimi API key not configured - cannot make trading decisions',
      };
    }

    const userContent = JSON.stringify({
      escalationReason,
      currentContext: context,
    }, null, 2);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'moonshot-v1-8k',
          messages: [
            { role: 'system', content: DECISION_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kimi API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      return this.parseDecisionResponse(content);
    } catch (error: any) {
      console.error('[Kimi] Decision error:', error.message);
      return {
        action: 'WAIT',
        reasoning: `Error making decision: ${error.message}. Defaulting to WAIT for safety.`,
      };
    }
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
    } catch (error: any) {
      console.error('[Kimi] Failed to parse response:', content);
      return {
        action: 'WAIT',
        reasoning: `Failed to parse LLM decision: ${error.message}. Defaulting to WAIT.`,
      };
    }
  }
}

// Singleton
export const kimiClient = new KimiClient();
