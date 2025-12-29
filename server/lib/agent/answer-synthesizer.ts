// server/lib/agent/answer-synthesizer.ts
// Step 3 of 3-step agent: Synthesize a natural language answer from fetched data

import { chatWithLLM } from '../llm-client';
import { FetchedData } from './data-fetcher';

const SYNTHESIS_PROMPT = `You are APEYOLO, a helpful 0DTE SPY options trading assistant. Answer the user's question using ONLY the provided data.

CRITICAL RULES:
1. ONLY use information from the provided data section below
2. If data is missing or incomplete, say "I couldn't get that information"
3. NEVER make up numbers, dates, prices, or facts
4. Be concise and direct - get to the answer quickly
5. If there were errors fetching data, mention what couldn't be retrieved
6. For time questions, include both HK and NY times if available
7. For market status, explain clearly if open/closed and why (weekend, holiday, pre-market, etc.)

Format your response naturally, as if speaking to the user. No need for headers or bullet points unless the answer is complex.`;

export async function synthesizeAnswer(
  userQuestion: string,
  data: FetchedData
): Promise<string> {
  console.log(`[Synthesizer] Generating answer for: "${userQuestion.slice(0, 50)}..."`);

  // Format the data for the LLM
  const dataDescription = formatDataForLLM(data);

  const response = await chatWithLLM({
    messages: [
      { role: 'system', content: SYNTHESIS_PROMPT },
      {
        role: 'user',
        content: `User question: "${userQuestion}"

=== AVAILABLE DATA ===
${dataDescription}

${data.errors.length > 0 ? `=== ERRORS ENCOUNTERED ===\n${data.errors.join('\n')}` : ''}

Please answer the user's question using only the data above:`
      }
    ],
    model: 'qwen2.5:32b',
  });

  console.log(`[Synthesizer] Answer generated (${response.message.content.length} chars)`);
  return response.message.content;
}

function formatDataForLLM(data: FetchedData): string {
  const parts: string[] = [];

  if (data.current_time) {
    parts.push(`CURRENT TIME:
- Hong Kong (HKT): ${data.current_time.hkt}
- New York (ET): ${data.current_time.nyt}
- UTC: ${data.current_time.utc}`);
  }

  if (data.market_status) {
    parts.push(`MARKET STATUS:
- Currently: ${data.market_status.isOpen ? 'OPEN' : 'CLOSED'}
- Status: ${data.market_status.status}
- Current ET time: ${data.market_status.nextChange}
${data.market_status.reason ? `- Reason: ${data.market_status.reason}` : ''}`);
  }

  if (data.spy_price) {
    const changeSign = data.spy_price.change >= 0 ? '+' : '';
    parts.push(`SPY PRICE:
- Current: $${data.spy_price.price.toFixed(2)}
- Change: ${changeSign}${data.spy_price.change.toFixed(2)} (${changeSign}${data.spy_price.changePercent.toFixed(2)}%)`);
  }

  if (data.vix) {
    parts.push(`VIX (Volatility Index):
- Current level: ${data.vix.value.toFixed(2)}
${data.vix.regime ? `- Regime: ${data.vix.regime}` : ''}`);
  }

  if (data.positions) {
    const s = data.positions.summary;
    parts.push(`PORTFOLIO POSITIONS:
- Total positions: ${s.totalPositions}
- Options: ${s.optionCount}
- Stocks: ${s.stockCount}
- Unrealized P&L: $${s.totalUnrealizedPnL.toFixed(2)}

Position details:
${data.positions.positions.slice(0, 10).map(p => {
  const pnl = p.unrealizedPnL ? ` (P&L: $${p.unrealizedPnL.toFixed(2)})` : '';
  return `- ${p.symbol} ${p.type || ''}: ${p.quantity} @ $${(p.avgCost || 0).toFixed(2)}${pnl}`;
}).join('\n')}`);
  }

  if (data.web_content) {
    parts.push(`WEB SEARCH RESULT:
Source: ${data.web_content.url}

Content:
${data.web_content.content.slice(0, 4000)}`);
  }

  if (parts.length === 0) {
    return 'No data was successfully retrieved.';
  }

  return parts.join('\n\n---\n\n');
}
