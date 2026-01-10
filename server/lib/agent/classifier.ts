// server/lib/agent/classifier.ts
// Fast query classification to route to appropriate agent pattern

export type QueryComplexity = 'simple' | 'complex' | 'trade';

// Single model for all queries - Qwen 2.5 72B via local Ollama
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5:72b';

interface ClassificationResult {
  complexity: QueryComplexity;
  reason: string;
  suggestedModel: string;
}

// Simple queries - can be answered with one tool call
const SIMPLE_PATTERNS = [
  { pattern: /what('s| is)?\s*(the\s*)?(time|date|day)/i, reason: 'time query' },
  { pattern: /current\s*(time|date)/i, reason: 'time query' },
  { pattern: /today('s)?\s*date/i, reason: 'time query' },
  { pattern: /(spy|SPY)\s*price/i, reason: 'price query' },
  { pattern: /what('s| is)?\s*(the\s*)?(spy|SPY)/i, reason: 'price query' },
  { pattern: /price\s*of\s*(spy|SPY)/i, reason: 'price query' },
  { pattern: /(vix|VIX)\s*(level|value|at)?/i, reason: 'VIX query' },
  { pattern: /what('s| is)?\s*(the\s*)?(vix|VIX)/i, reason: 'VIX query' },
  { pattern: /market\s*(open|closed|status|hours)/i, reason: 'market status query' },
  { pattern: /is\s*(the\s*)?market/i, reason: 'market status query' },
  { pattern: /(my\s*)?positions?/i, reason: 'positions query' },
  { pattern: /portfolio/i, reason: 'positions query' },
  { pattern: /(show|list|get)\s*positions?/i, reason: 'positions query' },
  { pattern: /p(&|and)?l|pnl|profit|loss/i, reason: 'P&L query' },
];

// Trade-related queries - need deep reasoning and human approval
const TRADE_PATTERNS = [
  { pattern: /trade|trading/i, reason: 'trade-related' },
  { pattern: /buy|sell/i, reason: 'trade action' },
  { pattern: /strangle|straddle/i, reason: 'options strategy' },
  { pattern: /option(s)?/i, reason: 'options query' },
  { pattern: /strike/i, reason: 'strike selection' },
  { pattern: /execute|enter|open\s*(a\s*)?(position|trade)/i, reason: 'trade execution' },
  { pattern: /close\s*(my\s*)?(position|trade)/i, reason: 'close position' },
  // Only match "should I" when trading context is present
  { pattern: /should\s*i.*(trade|buy|sell|enter|exit|open|close)/i, reason: 'trading advice' },
  { pattern: /recommend.*(trade|option|position|strategy)/i, reason: 'trading recommendation' },
  { pattern: /(trade|trading)\s*opportunity|opportunities/i, reason: 'trade opportunity' },
  { pattern: /find\s*(me\s*)?(a\s*)?trade/i, reason: 'trade search' },
];

/**
 * Classify a user query to determine the appropriate agent pattern.
 * All queries use Qwen 2.5 72B - simple, fast, consistent.
 */
export function classifyQuery(message: string): ClassificationResult {
  // Check for simple patterns first
  for (const { pattern, reason } of SIMPLE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        complexity: 'simple',
        reason,
        suggestedModel: LLM_MODEL,
      };
    }
  }

  // Check for trade patterns
  for (const { pattern, reason } of TRADE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        complexity: 'trade',
        reason,
        suggestedModel: LLM_MODEL,
      };
    }
  }

  // Default to complex for anything else
  return {
    complexity: 'complex',
    reason: 'general query requiring analysis',
    suggestedModel: LLM_MODEL,
  };
}
