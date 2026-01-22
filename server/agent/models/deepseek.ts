import { AgentContext, Observation, TriageResult } from '../types';
import { logger } from '../logger';
import { extractJSON } from '../utils/parseJson';

const TRIAGE_SYSTEM_PROMPT = `You are the triage layer for APE Agent, an autonomous 0DTE SPY options trader.

Your job:
1. Assess the current market situation
2. Decide if this is routine (handle yourself) or complex (escalate to decision model)

Respond with JSON only:
{
  "escalate": boolean,
  "reason": "why escalate or why not (1 sentence)",
  "reasoning": "your thinking process (2-3 sentences max)"
}

Escalate when:
- Clear trend that might warrant entry (even before 12 PM if strong conviction)
- Position needs attention (approaching stop, profit target)
- Unusual market conditions (VIX spike, gap move)
- Trading window open and conditions look favorable for entry

Don't escalate when:
- Market closed or pre-market
- Nothing notable happening, routine observation
- Already have max positions for today (1 trade/day limit)
- After 3:55 PM ET (too late to enter)

Be concise. No verbose explanations.`;

export class DeepSeekClient {
  private baseUrl = 'https://nonperversive-dianne-sketchily.ngrok-free.dev';  // Ollama via ngrok

  constructor() {
    console.log('[DeepSeek] Using local Ollama at', this.baseUrl);
  }

  async triage(context: AgentContext, recentMemory: Observation[], sessionId?: string): Promise<TriageResult> {

    const userContent = JSON.stringify({
      context,
      recentObservations: recentMemory.slice(0, 5).map(o => ({
        time: o.timestamp,
        spyPrice: o.context.spyPrice,
        vix: o.context.vixLevel,
        hadPosition: o.context.hasPosition,
        decision: o.triageResult?.escalate ? 'escalated' : 'routine',
      })),
    }, null, 2);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-r1:70b',
          messages: [
            { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 500,  // Extra tokens for thinking
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      return this.parseTriageResponse(content, sessionId);
    } catch (error: any) {
      console.error('[DeepSeek] Triage error:', error.message);
      return {
        escalate: false,
        reason: `Error: ${error.message}`,
        reasoning: 'Triage failed, defaulting to no escalation',
      };
    }
  }

  private parseTriageResponse(content: string, sessionId?: string): TriageResult {
    const { json, thinking, error } = extractJSON<{
      escalate: boolean;
      reason: string;
      reasoning: string;
    }>(content);

    // Log thinking if present
    if (thinking) {
      logger.log({
        sessionId: sessionId || 'triage',
        type: 'THINK',
        message: `[R1] ${thinking.substring(0, 500)}${thinking.length > 500 ? '...' : ''}`,
      });
    }

    if (!json) {
      console.error('[DeepSeek] Parse failed:', error, '\nRaw:', content.substring(0, 500));
      return {
        escalate: false,
        reason: 'Failed to parse LLM response',
        reasoning: error || content.substring(0, 200),
      };
    }

    return {
      escalate: Boolean(json.escalate),
      reason: String(json.reason || 'No reason provided'),
      reasoning: thinking
        ? `[Thinking] ${thinking.substring(0, 150)}... | ${json.reasoning}`
        : String(json.reasoning || 'No reasoning provided'),
    };
  }
}

// Singleton
export const deepseekClient = new DeepSeekClient();
