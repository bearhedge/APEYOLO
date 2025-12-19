/**
 * Command Center - Autonomous Trading Agent Orchestrator
 *
 * Central orchestrator that:
 * - Handles the tick workflow (called every 5 min by Cloud Scheduler)
 * - Decides which model to use for each task
 * - Manages positions
 * - Records ticks to knowledge base
 *
 * Philosophy: Code orchestrates, LLM reasons at specific decision points.
 */

import { getBroker } from '../broker';
import { analyzeMarketRegime } from '../engine/step1';
import { loadKnowledge, recordTick, getRecentTicks } from './knowledge';
import { think, streamThink, validateProposal, quickCheck } from './models';
import type { AgentTick, InsertAgentTick } from '@shared/schema';

// =============================================================================
// TYPES
// =============================================================================

export type TickDecision =
  | 'WAIT'      // Market closed or outside trading hours
  | 'HOLD'      // Conditions not favorable, waiting
  | 'ANALYZE'   // Running deep analysis
  | 'PROPOSE'   // Generated a trade proposal
  | 'MANAGE'    // Managing existing position
  | 'ERROR';    // Something went wrong

export interface MarketContext {
  vix: number;
  spyPrice: number;
  hasPosition: boolean;
  marketHours: boolean;
  canTrade: boolean;
  volatilityRegime: string;
  currentTime: string;
}

export interface TickResult {
  decision: TickDecision;
  reasoning?: string;
  proposal?: any;
  modelUsed?: string;
  durationMs: number;
  error?: string;
}

// =============================================================================
// MARKET CONTEXT
// =============================================================================

/**
 * Get current market context from broker
 */
export async function getMarketContext(): Promise<MarketContext | null> {
  try {
    const { api } = getBroker();
    if (!api) {
      console.log('[CommandCenter] Broker not connected');
      return null;
    }

    // Fetch SPY and VIX data
    const [spyData, vixData] = await Promise.all([
      api.getMarketData('SPY').catch(() => null),
      api.getMarketData('VIX').catch(() => null),
    ]);

    // Analyze market regime
    const regime = await analyzeMarketRegime(true, 'SPY');

    // Get positions
    const positions = await api.getPositions().catch(() => []);
    const hasOptionPosition = positions.some((p: any) =>
      (p.contract?.secType === 'OPT' || p.assetClass === 'OPT') &&
      (p.quantity !== 0 || p.position !== 0)
    );

    // Format current time as HH:MM
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });

    return {
      vix: vixData?.price || 0,
      spyPrice: spyData?.price || 0,
      hasPosition: hasOptionPosition,
      marketHours: regime.withinTradingWindow,
      canTrade: regime.canExecute,
      volatilityRegime: regime.volatilityRegime || 'UNKNOWN',
      currentTime,
    };
  } catch (error) {
    console.error('[CommandCenter] Failed to get market context:', error);
    return null;
  }
}

// =============================================================================
// POSITION MANAGEMENT
// =============================================================================

/**
 * Manage existing position (monitor, exit, adjust)
 */
async function managePosition(context: MarketContext): Promise<{
  action: 'HOLD' | 'EXIT' | 'ADJUST';
  reasoning: string;
}> {
  // For now, simple position monitoring
  // TODO: Add more sophisticated position management
  return {
    action: 'HOLD',
    reasoning: 'Monitoring existing position',
  };
}

// =============================================================================
// TRADE ANALYSIS
// =============================================================================

/**
 * Deep analysis using Thinker model
 */
async function analyzeTradeOpportunity(
  context: MarketContext,
  knowledgeSummary: string
): Promise<{
  shouldTrade: boolean;
  reasoning: string;
  strategy?: string;
}> {
  const systemPrompt = `You are an expert options trader analyzing whether to enter a trade.

Your trading strategy: Sell 0DTE SPY options (puts, calls, or strangles) to collect premium.

Rules:
- Only trade during optimal market hours (10:00 AM - 3:30 PM ET)
- VIX between 12-25 is ideal for premium selling
- Avoid trading around major economic events
- Be patient - only trade when conditions are clearly favorable
- Quality over quantity - one good trade is better than many mediocre ones

Based on the market context and historical knowledge, decide if NOW is a good time to trade.

Respond in JSON format:
{
  "shouldTrade": boolean,
  "reasoning": "string explaining your analysis",
  "strategy": "PUT" | "CALL" | "STRANGLE" | null
}`;

  const userMessage = `Current Market Context:
- VIX: ${context.vix.toFixed(2)}
- SPY Price: $${context.spyPrice.toFixed(2)}
- Volatility Regime: ${context.volatilityRegime}
- Current Time (ET): ${context.currentTime}
- Market Hours: ${context.marketHours}
- Can Trade: ${context.canTrade}

${knowledgeSummary}

Should we enter a trade now?`;

  try {
    const response = await think(systemPrompt, userMessage);

    // Parse JSON response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      shouldTrade: false,
      reasoning: response.content,
    };
  } catch (error: any) {
    console.error('[CommandCenter] Analysis error:', error);
    return {
      shouldTrade: false,
      reasoning: `Analysis failed: ${error.message}`,
    };
  }
}

// =============================================================================
// MAIN TICK HANDLER
// =============================================================================

/**
 * Handle a tick - the main entry point called by Cloud Scheduler
 */
export async function handleTick(): Promise<TickResult> {
  const startTime = Date.now();
  let decision: TickDecision = 'WAIT';
  let reasoning: string | undefined;
  let proposal: any | undefined;
  let modelUsed: string | undefined;
  let error: string | undefined;

  try {
    // 1. GET MARKET CONTEXT (code - no LLM)
    const context = await getMarketContext();

    if (!context) {
      decision = 'ERROR';
      error = 'Failed to get market context - broker not connected';
      return createTickResult(decision, reasoning, proposal, modelUsed, startTime, error);
    }

    // 2. QUICK CHECK - Market hours (code - no LLM)
    if (!context.marketHours) {
      decision = 'WAIT';
      reasoning = 'Market is closed';
      return createTickResult(decision, reasoning, proposal, modelUsed, startTime);
    }

    // 3. POSITION CHECK (code - no LLM)
    if (context.hasPosition) {
      decision = 'MANAGE';
      const management = await managePosition(context);
      reasoning = management.reasoning;
      return createTickResult(decision, reasoning, proposal, modelUsed, startTime);
    }

    // 4. QUICK FEASIBILITY CHECK (Executor model - fast)
    const feasibility = await quickCheck({
      vix: context.vix,
      spyPrice: context.spyPrice,
      hasPosition: context.hasPosition,
      marketHours: context.marketHours,
    });
    modelUsed = 'executor';

    if (!feasibility.shouldAnalyze) {
      decision = 'HOLD';
      reasoning = feasibility.reason;
      return createTickResult(decision, reasoning, proposal, modelUsed, startTime);
    }

    // 5. LOAD KNOWLEDGE (code - no LLM)
    const knowledge = await loadKnowledge(context.vix, context.currentTime);

    // 6. DEEP ANALYSIS (Thinker model - slow, expensive)
    decision = 'ANALYZE';
    modelUsed = 'thinker';
    const analysis = await analyzeTradeOpportunity(context, knowledge.summary);
    reasoning = analysis.reasoning;

    if (!analysis.shouldTrade) {
      decision = 'HOLD';
      return createTickResult(decision, reasoning, proposal, modelUsed, startTime);
    }

    // 7. GENERATE PROPOSAL (code - run engine)
    // TODO: Integrate with trading engine to generate proposal
    // For now, just mark as proposing
    decision = 'PROPOSE';
    proposal = {
      strategy: analysis.strategy,
      symbol: 'SPY',
      status: 'pending_implementation',
    };

    // 8. VALIDATE PROPOSAL (Processor model)
    // TODO: Call validateProposal with real proposal
    // modelUsed = 'processor';

    return createTickResult(decision, reasoning, proposal, modelUsed, startTime);

  } catch (err: any) {
    console.error('[CommandCenter] Tick error:', err);
    decision = 'ERROR';
    error = err.message || 'Unknown error';
    return createTickResult(decision, reasoning, proposal, modelUsed, startTime, error);
  }
}

/**
 * Create tick result and record to database
 */
async function createTickResult(
  decision: TickDecision,
  reasoning: string | undefined,
  proposal: any | undefined,
  modelUsed: string | undefined,
  startTime: number,
  error?: string
): Promise<TickResult> {
  const durationMs = Date.now() - startTime;

  // Get market context for recording (may be null if error)
  let marketContext: any = null;
  try {
    const context = await getMarketContext();
    if (context) {
      marketContext = {
        vix: context.vix,
        spyPrice: context.spyPrice,
        hasPosition: context.hasPosition,
        marketHours: context.marketHours,
      };
    }
  } catch {
    // Ignore - context may not be available
  }

  // Record tick to database
  try {
    await recordTick({
      tickTime: new Date(),
      marketContext,
      decision,
      reasoning: reasoning || error,
      modelUsed,
      proposalId: proposal?.id,
      durationMs,
    });
  } catch (dbError) {
    console.error('[CommandCenter] Failed to record tick:', dbError);
  }

  return {
    decision,
    reasoning: error ? `Error: ${error}` : reasoning,
    proposal,
    modelUsed,
    durationMs,
    error,
  };
}

// =============================================================================
// STREAMING TICK (for real-time UI updates)
// =============================================================================

/**
 * Handle tick with SSE streaming for UI
 */
export async function* handleTickWithStreaming(): AsyncGenerator<{
  type: 'status' | 'thinking' | 'result' | 'done' | 'error';
  phase?: string;
  content?: string;
  data?: any;
}, void, unknown> {
  const startTime = Date.now();

  try {
    // 1. Status update
    yield { type: 'status', phase: 'context', content: 'Getting market context...' };
    const context = await getMarketContext();

    if (!context) {
      yield { type: 'error', content: 'Broker not connected' };
      return;
    }

    yield { type: 'result', content: `VIX: ${context.vix.toFixed(1)}, SPY: $${context.spyPrice.toFixed(2)}` };

    // 2. Market hours check
    if (!context.marketHours) {
      yield { type: 'done', data: { decision: 'WAIT', reasoning: 'Market closed' } };
      return;
    }

    // 3. Position check
    if (context.hasPosition) {
      yield { type: 'status', phase: 'manage', content: 'Managing existing position...' };
      const management = await managePosition(context);
      yield { type: 'done', data: { decision: 'MANAGE', reasoning: management.reasoning } };
      return;
    }

    // 4. Quick check
    yield { type: 'status', phase: 'quick-check', content: 'Quick feasibility check...' };
    const feasibility = await quickCheck({
      vix: context.vix,
      spyPrice: context.spyPrice,
      hasPosition: context.hasPosition,
      marketHours: context.marketHours,
    });

    if (!feasibility.shouldAnalyze) {
      yield { type: 'done', data: { decision: 'HOLD', reasoning: feasibility.reason } };
      return;
    }

    // 5. Load knowledge
    yield { type: 'status', phase: 'knowledge', content: 'Loading knowledge...' };
    const knowledge = await loadKnowledge(context.vix, context.currentTime);

    // 6. Deep analysis with streaming
    yield { type: 'status', phase: 'analyze', content: 'Deep analysis with Thinker...' };

    // Stream thinking process
    let thinkingContent = '';
    const systemPrompt = `You are an expert options trader. Analyze if NOW is a good time to trade.`;
    const userMessage = `VIX: ${context.vix.toFixed(2)}, SPY: $${context.spyPrice.toFixed(2)}\n\n${knowledge.summary}`;

    for await (const chunk of streamThink(systemPrompt, userMessage)) {
      if (chunk.message?.content) {
        thinkingContent += chunk.message.content;
        yield { type: 'thinking', content: chunk.message.content };
      }
    }

    // Parse result
    let shouldTrade = false;
    try {
      const jsonMatch = thinkingContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        shouldTrade = parsed.shouldTrade;
      }
    } catch {
      // Parsing failed, assume no trade
    }

    const decision = shouldTrade ? 'PROPOSE' : 'HOLD';
    yield {
      type: 'done',
      data: {
        decision,
        reasoning: thinkingContent,
        durationMs: Date.now() - startTime,
      },
    };

  } catch (error: any) {
    yield { type: 'error', content: error.message };
  }
}

// =============================================================================
// STATUS & HISTORY
// =============================================================================

/**
 * Get recent tick history
 */
export async function getTickHistory(limit: number = 50): Promise<AgentTick[]> {
  return getRecentTicks(limit);
}

/**
 * Get command center status
 */
export async function getStatus(): Promise<{
  online: boolean;
  brokerConnected: boolean;
  lastTick?: AgentTick;
  recentDecisions: Record<string, number>;
}> {
  const { status } = getBroker();
  const recentTicks = await getRecentTicks(20);

  // Count recent decisions
  const recentDecisions: Record<string, number> = {};
  for (const tick of recentTicks) {
    recentDecisions[tick.decision] = (recentDecisions[tick.decision] || 0) + 1;
  }

  return {
    online: status.connected,
    brokerConnected: status.connected,
    lastTick: recentTicks[0],
    recentDecisions,
  };
}
