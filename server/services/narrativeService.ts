/**
 * Narrative Generation Service
 *
 * Generates AI-powered market analysis narratives using market context.
 * Uses the existing LLM client infrastructure (Ollama/Vertex AI).
 */

import { chatWithLLM, streamChatWithLLM, type LLMMessage } from '../lib/llm-client';

// DeepSeek model for deep market analysis
const NARRATIVE_MODEL = 'deepseek-r1:70b';
import { fetchMacroData, type MacroData } from './macroDataService';
import { getOptionChainStreamer } from '../broker/optionChainStreamer';
import { getMarketStatus } from './marketCalendar';

// ============================================
// Types
// ============================================

export interface ResearchContext {
  spy: {
    price: number;
    change: number;
    changePct: number;
    dayHigh: number;
    dayLow: number;
  };
  vix: {
    level: number;
    change: number;
  };
  macro: MacroData;
  marketStatus: {
    isOpen: boolean;
    reason: string;
  };
  timestamp: string;
}

export interface NarrativeResult {
  narrative: string;
  thinking?: string;  // DeepSeek reasoning tokens
  context: ResearchContext;
  generatedAt: string;
}

// ============================================
// Market Analyst Prompt
// ============================================

const MARKET_ANALYST_SYSTEM_PROMPT = `You are a senior market analyst providing real-time market interpretation.
Your job is to synthesize data into actionable narrative - not just report numbers.

Given the current market context, write a 2-3 paragraph analysis covering:
1. What's happening right now (price action, volatility regime)
2. What it means (interpretation, not just data)
3. What to watch (key levels, upcoming catalysts)

Be direct. No fluff. Write like you're briefing a trader who needs to make decisions.
Focus on SPY 0DTE trading context.

Format your response as plain text paragraphs, no headers or bullet points.`;

// ============================================
// Context Assembly
// ============================================

/**
 * Assemble research context from various data sources
 */
export async function assembleResearchContext(): Promise<ResearchContext> {
  // Get streamer for SPY data
  const streamer = getOptionChainStreamer();
  const chain = streamer.getOptionChain('SPY');

  // Fetch macro data
  const macroData = await fetchMacroData();

  // Get market status
  const marketStatus = getMarketStatus();

  // Use chain data if available, otherwise defaults
  const underlyingPrice = chain?.underlyingPrice || 0;
  const vixLevel = chain?.vix || 0;

  // Calculate day high/low from expected move if available
  const expectedMove = chain?.expectedMove || 0;
  const dayHigh = chain?.strikeRangeHigh || underlyingPrice + expectedMove;
  const dayLow = chain?.strikeRangeLow || underlyingPrice - expectedMove;

  return {
    spy: {
      price: underlyingPrice,
      change: 0, // Would need previous close to calculate
      changePct: 0,
      dayHigh,
      dayLow,
    },
    vix: {
      level: vixLevel,
      change: 0, // Would need previous to calculate
    },
    macro: macroData,
    marketStatus: {
      isOpen: marketStatus.isOpen,
      reason: marketStatus.reason,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format context as a string for the LLM prompt
 */
function formatContextForPrompt(context: ResearchContext): string {
  const etTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines = [
    'Current Market Data:',
    `- SPY: $${context.spy.price.toFixed(2)}${context.spy.change !== 0 ? ` (${context.spy.change >= 0 ? '+' : ''}${context.spy.changePct.toFixed(2)}%)` : ''}`,
    `  Day Range: $${context.spy.dayLow.toFixed(2)} - $${context.spy.dayHigh.toFixed(2)}`,
    `- VIX: ${context.vix.level.toFixed(2)}${context.vix.change !== 0 ? ` (${context.vix.change >= 0 ? '+' : ''}${context.vix.change.toFixed(2)})` : ''}`,
  ];

  if (context.macro.dxy) {
    lines.push(`- DXY: ${context.macro.dxy.price.toFixed(2)} (${context.macro.dxy.changePct.toFixed(2)}%)`);
  }

  if (context.macro.tenYear) {
    lines.push(`- 10Y Yield: ${context.macro.tenYear.yield.toFixed(3)}%`);
  }

  lines.push('');
  lines.push(`Time: ${etTime} ET`);
  lines.push(`Market Status: ${context.marketStatus.isOpen ? 'Open' : 'Closed'} (${context.marketStatus.reason})`);

  return lines.join('\n');
}

// ============================================
// Narrative Generation
// ============================================

/**
 * Generate AI-powered market narrative using DeepSeek-R1
 * Streams thinking tokens and captures the final narrative
 */
export async function generateNarrative(): Promise<NarrativeResult> {
  // Assemble context
  const context = await assembleResearchContext();

  // Format for prompt
  const contextString = formatContextForPrompt(context);

  // Build messages
  const messages: LLMMessage[] = [
    { role: 'system', content: MARKET_ANALYST_SYSTEM_PROMPT },
    { role: 'user', content: contextString },
  ];

  try {
    // Stream narrative using DeepSeek-R1 with thinking enabled
    let narrative = '';
    let thinking = '';

    for await (const chunk of streamChatWithLLM({
      messages,
      model: NARRATIVE_MODEL,
      stream: true,
    })) {
      // Accumulate thinking tokens
      if (chunk.message?.thinking) {
        thinking += chunk.message.thinking;
      }

      // Accumulate narrative content
      if (chunk.message?.content) {
        narrative += chunk.message.content;
      }
    }

    console.log(`[NarrativeService] Generated with ${thinking.length} thinking chars, ${narrative.length} narrative chars`);

    return {
      narrative,
      thinking: thinking || undefined,
      context,
      generatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[NarrativeService] Generation failed:', error.message);

    // Return a fallback narrative with the error
    return {
      narrative: `Unable to generate narrative: ${error.message}. Please check LLM configuration.`,
      context,
      generatedAt: new Date().toISOString(),
    };
  }
}
