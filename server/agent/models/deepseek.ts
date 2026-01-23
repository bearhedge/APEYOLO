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
  private baseUrl = 'https://nonperversive-dianne-sketchily.ngrok-free.dev';  // Ollama via ngrok

  constructor() {
    console.log('[DeepSeek] Using local Ollama at', this.baseUrl);
  }

  async triage(context: AgentContext, recentMemory: Observation[]): Promise<TriageResult> {

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

  /**
   * Multi-turn chat method for CodeAct orchestrator.
   * Streams the response so you can see thinking in real-time.
   */
  async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
    try {
      // 3 minute timeout - 70B models need time to think
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      console.log('[DeepSeek] 🧠 Starting chat with', messages.length, 'messages (streaming)');

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          model: 'deepseek-r1:70b',
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        const error = await response.text();
        throw new Error(`DeepSeek chat failed: ${response.status} - ${error}`);
      }

      // Stream the response and log thinking in real-time
      let thinking = '';
      let content = '';
      let lastLogTime = Date.now();
      let tokenCount = 0;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        clearTimeout(timeoutId);
        throw new Error('No response body');
      }

      console.log('[DeepSeek] 💭 Thinking...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse each line (Ollama streams newline-delimited JSON)
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            // DeepSeek R1 streams thinking separately from content
            const thinkPart = data.message?.thinking || '';
            const contentPart = data.message?.content || '';

            thinking += thinkPart;
            content += contentPart;
            tokenCount++;

            // Log thinking progress every 2 seconds
            const now = Date.now();
            if (now - lastLogTime > 2000) {
              if (thinking && !content) {
                // Still in thinking phase - show recent thinking
                const recent = thinking.slice(-300).replace(/\n/g, ' ');
                console.log(`[DeepSeek] 💭 ${recent}`);
              } else if (content) {
                // In content phase - show recent content
                const recent = content.slice(-200).replace(/\n/g, ' ');
                console.log(`[DeepSeek] 📝 ${recent}`);
              }
              lastLogTime = now;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      clearTimeout(timeoutId);

      // Log summary
      console.log(`[DeepSeek] ✅ Done! Thinking: ${thinking.length} chars, Content: ${content.length} chars`);

      // Log the full thinking
      if (thinking) {
        console.log('[DeepSeek] 🧠 Full thinking:');
        // Split into chunks for logging
        const lines = thinking.split('\n');
        for (const line of lines.slice(0, 20)) {
          if (line.trim()) console.log(`[DeepSeek]    ${line}`);
        }
        if (lines.length > 20) {
          console.log(`[DeepSeek]    ... (${lines.length - 20} more lines)`);
        }
      }

      // Return content wrapped with think tags for orchestrator parsing
      const fullResponse = thinking
        ? `<think>\n${thinking}\n</think>\n\n${content}`
        : content;

      return fullResponse;
    } catch (error: any) {
      console.error('[DeepSeek] ❌ Chat error:', error.message);
      throw error;
    }
  }

  private parseTriageResponse(content: string): TriageResult {
    try {
      // Extract <think>...</think> reasoning from deepseek-r1
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      const thinkingRaw = thinkMatch ? thinkMatch[1].trim() : '';

      // Remove thinking tags to get the answer
      const answerContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // Log thinking if present
      if (thinkingRaw) {
        console.log('[DeepSeek] Thinking:', thinkingRaw.substring(0, 300));
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = answerContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Use the model's thinking as part of reasoning if available
      const modelReasoning = String(parsed.reasoning || 'No reasoning provided');
      const fullReasoning = thinkingRaw
        ? `[Thinking] ${thinkingRaw.substring(0, 150)}... | ${modelReasoning}`
        : modelReasoning;

      return {
        escalate: Boolean(parsed.escalate),
        reason: String(parsed.reason || 'No reason provided'),
        reasoning: fullReasoning,
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
