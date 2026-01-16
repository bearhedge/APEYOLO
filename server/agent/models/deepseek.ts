import { AgentContext, Observation, TriageResult } from '../types';

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
  private apiKey: string;
  private baseUrl = 'https://api.deepseek.com';

  constructor() {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) {
      console.warn('[DeepSeek] DEEPSEEK_API_KEY not set - client will fail on calls');
    }
    this.apiKey = key || '';
  }

  async triage(context: AgentContext, recentMemory: Observation[]): Promise<TriageResult> {
    if (!this.apiKey) {
      return {
        escalate: false,
        reason: 'DeepSeek API key not configured',
        reasoning: 'Cannot triage without API access',
      };
    }

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
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      return this.parseTriageResponse(content);
    } catch (error: any) {
      console.error('[DeepSeek] Triage error:', error.message);
      return {
        escalate: false,
        reason: `Error: ${error.message}`,
        reasoning: 'Triage failed, defaulting to no escalation',
      };
    }
  }

  private parseTriageResponse(content: string): TriageResult {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        escalate: Boolean(parsed.escalate),
        reason: String(parsed.reason || 'No reason provided'),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
      };
    } catch (error: any) {
      console.error('[DeepSeek] Failed to parse response:', content);
      return {
        escalate: false,
        reason: 'Failed to parse LLM response',
        reasoning: content.substring(0, 200),
      };
    }
  }
}

// Singleton
export const deepseekClient = new DeepSeekClient();
