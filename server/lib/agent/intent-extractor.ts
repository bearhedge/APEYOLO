// server/lib/agent/intent-extractor.ts
// Step 1 of 3-step agent: Extract what information is needed to answer the user's question

import { chatWithLLM } from '../llm-client';

export interface IntentNeeds {
  current_time: boolean;      // User wants to know the time
  market_status: boolean;     // User wants to know if market is open
  spy_price: boolean;         // User wants SPY price
  vix: boolean;               // User wants VIX value
  positions: boolean;         // User wants their positions/P&L
  web_search: string | null;  // Search query if web needed, null otherwise
}

export interface ExtractedIntent {
  needs: IntentNeeds;
  reasoning: string;
}

const INTENT_PROMPT = `You are analyzing a user's question to determine what information is needed to answer it.

Given the question, output a JSON object with these fields:
- needs.current_time: true if user wants to know the current time
- needs.market_status: true if user asks about market open/closed/hours
- needs.spy_price: true if user wants current SPY price
- needs.vix: true if user wants current VIX
- needs.positions: true if user asks about their portfolio/positions/P&L
- needs.web_search: a search query string if web search is needed, or null if not

Rules:
- For questions about specific dates/holidays/calendars, use web_search
- For questions about CURRENT time/market/prices, use the appropriate API fields
- Set multiple fields to true if the question needs multiple data sources
- Be precise with web_search queries - make them specific

Output ONLY valid JSON, no other text.`;

export async function extractIntent(userMessage: string): Promise<ExtractedIntent> {
  console.log(`[IntentExtractor] Extracting intent from: "${userMessage.slice(0, 100)}..."`);

  const response = await chatWithLLM({
    messages: [
      { role: 'system', content: INTENT_PROMPT },
      { role: 'user', content: `Question: "${userMessage}"\n\nOutput the JSON:` }
    ],
    model: 'qwen2.5:32b',
  });

  try {
    // Clean the response - remove markdown code blocks if present
    let content = response.message.content.trim();
    if (content.startsWith('```json')) {
      content = content.slice(7);
    } else if (content.startsWith('```')) {
      content = content.slice(3);
    }
    if (content.endsWith('```')) {
      content = content.slice(0, -3);
    }
    content = content.trim();

    const parsed = JSON.parse(content);

    const intent: ExtractedIntent = {
      needs: {
        current_time: parsed.needs?.current_time || false,
        market_status: parsed.needs?.market_status || false,
        spy_price: parsed.needs?.spy_price || false,
        vix: parsed.needs?.vix || false,
        positions: parsed.needs?.positions || false,
        web_search: parsed.needs?.web_search || null,
      },
      reasoning: parsed.reasoning || 'No reasoning provided',
    };

    console.log(`[IntentExtractor] Extracted: ${JSON.stringify(intent.needs)}`);
    return intent;
  } catch (e) {
    // Fallback: if parsing fails, default to web search
    console.error('[IntentExtractor] JSON parse failed, defaulting to web search. Raw:', response.message.content);
    return {
      needs: {
        current_time: false,
        market_status: false,
        spy_price: false,
        vix: false,
        positions: false,
        web_search: userMessage,
      },
      reasoning: 'JSON parsing failed, using web search as fallback',
    };
  }
}
