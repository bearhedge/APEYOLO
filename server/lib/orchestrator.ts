/**
 * Dual-Brain Trading Agent Orchestrator
 *
 * Implements the Review & Critique pattern from Google Cloud's Agentic AI patterns:
 * 1. PROPOSER (DeepSeek-R1:70b) analyzes and proposes trades
 * 2. CRITIC (Qwen2.5:72b) validates proposals against mandate and risk rules
 * 3. Both must agree before trade is presented for human approval
 *
 * This ensures safety through consensus - no single model can make a bad trade.
 */

import {
  chatWithProposer,
  chatWithCritic,
  type LLMMessage,
  type LLMChatResponse,
} from './llm-client';

// ============================================
// Types
// ============================================

export interface TradeProposal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';
  symbol: string;
  optionType?: 'CALL' | 'PUT';
  strike?: number;
  expiry?: string; // e.g., "0DTE", "2024-12-20"
  quantity?: number;
  price?: number;
  confidence: number; // 0-100
  reasoning: string;
}

export interface CritiqueResult {
  approved: boolean;
  mandateCompliant: boolean;
  riskAssessment: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  concerns: string[];
  suggestions: string[];
  reasoning: string;
}

export interface DualBrainResult {
  success: boolean;
  consensus: boolean;
  proposal?: TradeProposal;
  critique?: CritiqueResult;
  proposerResponse: string;
  criticResponse: string;
  awaitingHumanApproval: boolean;
  rejectionReason?: string;
  timestamp: Date;
  durationMs: number;
}

export interface TradingContext {
  // Current market state
  spyPrice: number;
  vix?: number;
  marketTrend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  // Current positions
  positions: Array<{
    symbol: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    greeks?: {
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
    };
  }>;

  // Account info
  portfolioValue: number;
  buyingPower: number;
  dayPnL: number;

  // Mandate constraints
  mandate: {
    allowedSymbols: string[];
    strategyType: 'SELL' | 'BUY';
    minDelta: number;
    maxDelta: number;
    maxDailyLossPercent: number;
    noOvernightPositions: boolean;
    maxPositionSize?: number;
  };
}

// ============================================
// System Prompts
// ============================================

const PROPOSER_SYSTEM_PROMPT = `You are APEYOLO's Trading Proposer - an expert 0DTE options analyst.

Your role:
1. Analyze market conditions and current positions
2. Identify trading opportunities within the mandate
3. Propose specific, actionable trades with clear reasoning

When proposing trades, always include:
- Action: BUY, SELL, HOLD, or CLOSE
- Symbol and option details (strike, expiry, type)
- Quantity and target price
- Confidence level (0-100%)
- Clear reasoning based on Greeks, market conditions, and risk

Format your trade proposal as JSON:
{
  "action": "SELL",
  "symbol": "SPY",
  "optionType": "PUT",
  "strike": 595,
  "expiry": "0DTE",
  "quantity": 1,
  "price": 1.50,
  "confidence": 75,
  "reasoning": "Your detailed reasoning here"
}

If no trade is recommended, respond with:
{
  "action": "HOLD",
  "confidence": 80,
  "reasoning": "Why holding is the best action"
}`;

const CRITIC_SYSTEM_PROMPT = `You are APEYOLO's Risk Critic - a strict risk management validator.

Your role:
1. Validate trade proposals against the trading mandate
2. Assess risk levels and potential issues
3. Either APPROVE or REJECT proposals with clear reasoning

Check every proposal for:
- Mandate compliance (allowed symbols, strategy type, delta range)
- Position sizing (not exceeding limits)
- Risk assessment (Greeks exposure, market conditions)
- Daily loss limits (not breaching max daily loss)
- Overnight position rules

Format your critique as JSON:
{
  "approved": true/false,
  "mandateCompliant": true/false,
  "riskAssessment": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "concerns": ["List of concerns if any"],
  "suggestions": ["List of suggestions if any"],
  "reasoning": "Your detailed validation reasoning"
}

Be strict but fair. If a trade is sound, approve it. If there are issues, explain them clearly.`;

// ============================================
// Core Orchestration Functions
// ============================================

/**
 * Execute the full Dual-Brain trade analysis workflow
 */
export async function analyzeTradeOpportunity(
  context: TradingContext,
  userRequest?: string
): Promise<DualBrainResult> {
  const startTime = Date.now();

  // Build context message for both models
  const contextMessage = buildContextMessage(context);

  // Step 1: Get proposal from Proposer
  const proposerMessages: LLMMessage[] = [
    { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
    { role: 'user', content: contextMessage },
  ];

  if (userRequest) {
    proposerMessages.push({ role: 'user', content: `User request: ${userRequest}` });
  }

  let proposerResponse: LLMChatResponse;
  try {
    proposerResponse = await chatWithProposer(proposerMessages);
  } catch (error: any) {
    return {
      success: false,
      consensus: false,
      proposerResponse: '',
      criticResponse: '',
      awaitingHumanApproval: false,
      rejectionReason: `Proposer error: ${error.message}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  // Parse proposal
  const proposal = parseProposal(proposerResponse.message.content);

  // If HOLD, no need for critic validation
  if (proposal?.action === 'HOLD') {
    return {
      success: true,
      consensus: true,
      proposal,
      proposerResponse: proposerResponse.message.content,
      criticResponse: 'No validation needed for HOLD action',
      awaitingHumanApproval: false,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  // Step 2: Get critique from Critic
  const criticMessages: LLMMessage[] = [
    { role: 'system', content: CRITIC_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `## Trading Context\n${contextMessage}\n\n## Proposed Trade\n${proposerResponse.message.content}\n\nPlease validate this trade proposal.`,
    },
  ];

  let criticResponse: LLMChatResponse;
  try {
    criticResponse = await chatWithCritic(criticMessages);
  } catch (error: any) {
    return {
      success: false,
      consensus: false,
      proposal,
      proposerResponse: proposerResponse.message.content,
      criticResponse: '',
      awaitingHumanApproval: false,
      rejectionReason: `Critic error: ${error.message}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  // Parse critique
  const critique = parseCritique(criticResponse.message.content);

  // Step 3: Check consensus
  const consensus = critique?.approved === true;

  return {
    success: true,
    consensus,
    proposal,
    critique,
    proposerResponse: proposerResponse.message.content,
    criticResponse: criticResponse.message.content,
    awaitingHumanApproval: consensus, // Only await approval if both agree
    rejectionReason: !consensus ? critique?.reasoning || 'Critic rejected proposal' : undefined,
    timestamp: new Date(),
    durationMs: Date.now() - startTime,
  };
}

/**
 * Quick analysis without full trade workflow (for simple queries)
 */
export async function quickAnalysis(
  context: TradingContext,
  question: string
): Promise<{ response: string; durationMs: number }> {
  const startTime = Date.now();

  const contextMessage = buildContextMessage(context);

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are APEYOLO, a helpful trading assistant. Answer questions about the portfolio and market concisely.',
    },
    { role: 'user', content: `${contextMessage}\n\nQuestion: ${question}` },
  ];

  const response = await chatWithProposer(messages);

  return {
    response: response.message.content,
    durationMs: Date.now() - startTime,
  };
}

// ============================================
// Helper Functions
// ============================================

function buildContextMessage(context: TradingContext): string {
  const positionsSummary = context.positions.length > 0
    ? context.positions.map(p =>
        `- ${p.symbol}: ${p.quantity} @ $${p.avgCost.toFixed(2)} | Current: $${p.currentPrice.toFixed(2)} | P&L: ${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${p.pnlPercent >= 0 ? '+' : ''}${p.pnlPercent.toFixed(1)}%)${p.greeks ? ` | Delta: ${p.greeks.delta.toFixed(2)}` : ''}`
      ).join('\n')
    : 'No open positions';

  return `## Current Market
SPY: $${context.spyPrice.toFixed(2)}
${context.vix ? `VIX: ${context.vix.toFixed(2)}` : ''}
${context.marketTrend ? `Trend: ${context.marketTrend}` : ''}

## Account
Portfolio Value: $${context.portfolioValue.toLocaleString()}
Buying Power: $${context.buyingPower.toLocaleString()}
Day P&L: ${context.dayPnL >= 0 ? '+' : ''}$${context.dayPnL.toFixed(2)}

## Current Positions
${positionsSummary}

## Trading Mandate
- Allowed Symbols: ${context.mandate.allowedSymbols.join(', ')}
- Strategy: ${context.mandate.strategyType} options
- Delta Range: ${context.mandate.minDelta} to ${context.mandate.maxDelta}
- Max Daily Loss: ${context.mandate.maxDailyLossPercent}%
- Overnight Positions: ${context.mandate.noOvernightPositions ? 'NOT ALLOWED' : 'Allowed'}
${context.mandate.maxPositionSize ? `- Max Position Size: $${context.mandate.maxPositionSize}` : ''}`;
}

function parseProposal(content: string): TradeProposal | undefined {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || 'HOLD',
        symbol: parsed.symbol || 'SPY',
        optionType: parsed.optionType,
        strike: parsed.strike,
        expiry: parsed.expiry,
        quantity: parsed.quantity,
        price: parsed.price,
        confidence: parsed.confidence || 50,
        reasoning: parsed.reasoning || content,
      };
    }
  } catch {
    // If JSON parsing fails, try to infer from text
  }

  return {
    action: 'HOLD',
    symbol: 'SPY',
    confidence: 50,
    reasoning: content,
  };
}

function parseCritique(content: string): CritiqueResult | undefined {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: parsed.approved === true,
        mandateCompliant: parsed.mandateCompliant === true,
        riskAssessment: parsed.riskAssessment || 'MEDIUM',
        concerns: parsed.concerns || [],
        suggestions: parsed.suggestions || [],
        reasoning: parsed.reasoning || content,
      };
    }
  } catch {
    // If JSON parsing fails, be conservative and reject
  }

  return {
    approved: false,
    mandateCompliant: false,
    riskAssessment: 'HIGH',
    concerns: ['Could not parse critic response'],
    suggestions: [],
    reasoning: content,
  };
}
